"""jedi's references to a file's declarations, for bench/uses.mts: a JSON request per line on
stdin, a JSON reply per line on stdout.

    {"op": "refs", "root": ..., "paths": [...], "file": ..., "specs": [{"name", "owner"}], "timeout": s}
      -> {"specs": [{"found": n, "timedOut": bool, "failed": bool, "refs": [[path, line, isImport]]}]}
    {"op": "names", "root": ..., "paths": [...], "file": ..., "words": [...], "resolve": [...]}  -> {"named": [...], "unresolved": [...]}
    {"op": "imports", "root": ..., "paths": [...], "file": ..., "target": ...}  -> {"imports": bool}

Paths are repo-relative; `paths` are folders on sys.path, relative to the root (flask's src).
A declaration is a top-level def, class or assignment, or one in a top-level class's body; a
constructor or dunder stands for its class, as isobar reads it. A reference on the lines of an
import statement is marked, so the caller can count uses the way isobar does (imports left out).
"""
import ast
import io
import json
import os
import re
import signal
import sys
import tokenize
import warnings

import jedi
import jedi.inference.references as references
import parso.cache

# jedi stops a project search after parsing 30 files that name the word; search them all
references._PARSED_FILE_LIMIT = references._OPENED_FILE_LIMIT = 10**9
# past 600 parsed files parso drops the ones unused for 10 minutes, which jedi still reads (a KeyError)
parso.cache._CACHED_SIZE_TRIGGER = 10**9
# a timeout can cut a pickle short, and processes in a pool read each other's half-written ones
parso.cache._save_to_file_system = lambda *args, **kwargs: None
# jedi's default environment answers from a subprocess over a pipe, which a timeout leaves out of step
ENVIRONMENT = jedi.InterpreterEnvironment()
# it warns on every module it cannot import (django.contrib.postgres without psycopg)
warnings.filterwarnings('ignore', category=UserWarning)

projects = {}
trees = {}


def project_of(root, paths):
    key = (root, tuple(paths))
    if key not in projects:
        projects[key] = jedi.Project(root, added_sys_path=[os.path.join(root, p) for p in paths])
    return projects[key]


def tree_of(path):
    """The file's AST and lines, read again whenever the file changes on disk."""
    stamp = os.stat(path).st_mtime_ns
    if trees.get(path, (None,))[0] != stamp:
        with open(path, encoding='utf-8', errors='replace') as f:
            text = f.read()
        try:
            tree = ast.parse(text)
        except SyntaxError:
            tree = None
        trees[path] = (stamp, tree, text.split('\n'))
    return trees[path][1:]


def import_lines(path):
    tree, _ = tree_of(path)
    lines = set()
    for node in ast.walk(tree) if tree is not None else []:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            lines.update(range(node.lineno, (node.end_lineno or node.lineno) + 1))
    return lines


def is_hook(name):
    return re.fullmatch(r'__\w+__', name) is not None


def positions(path, name, owner):
    """(line, column) of each declaration named `name`, in the top-level class `owner` when given."""
    tree, lines = tree_of(path)
    if tree is None:
        return []
    body = tree.body
    if owner is not None:
        classes = [n for n in body if isinstance(n, ast.ClassDef) and n.name == owner]
        if is_hook(name):
            name, body = owner, classes
        else:
            body = [m for c in classes for m in c.body]
    out = []
    for node in body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == name:
            m = re.search(r'\b(?:def|class)\s+(' + re.escape(name) + r')\b', lines[node.lineno - 1])
            if m:
                out.append((node.lineno, m.start(1)))
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        for t in targets:
            for n in ast.walk(t):
                if isinstance(n, ast.Name) and n.id == name:
                    # ast counts columns in UTF-8 bytes, jedi in characters
                    out.append((n.lineno, len(lines[n.lineno - 1].encode()[:n.col_offset].decode(errors='ignore'))))
    return out


class Timeout(Exception):
    pass


def alarm(*_):
    raise Timeout()


signal.signal(signal.SIGALRM, alarm)


def refs(req):
    root = req['root']
    path = os.path.join(root, req['file'])
    project = project_of(root, req.get('paths', []))
    out = []
    for spec in req['specs']:
        at = positions(path, spec['name'], spec.get('owner'))
        found, timed_out, failed = [], False, False
        if any(o['timedOut'] or o['failed'] for o in out):
            # one spec without an answer leaves the file out: skip the rest
            out.append({'found': len(at), 'timedOut': False, 'failed': False, 'skipped': True, 'refs': []})
            continue
        signal.alarm(req.get('timeout', 20))
        try:
            script = jedi.Script(path=path, project=project, environment=ENVIRONMENT)
            for line, column in at:
                for r in script.get_references(line, column, include_builtins=False):
                    if r.module_path is None:
                        continue
                    rel = os.path.relpath(str(r.module_path), root)
                    if not rel.startswith('..'):
                        found.append([rel, r.line, r.line in import_lines(str(r.module_path))])
        except Timeout:
            timed_out = True
        except Exception as e:  # jedi fails on some inputs: the spec has no answer
            failed = True
            print(f'pyrefs: {req["file"]} {spec["name"]}: {type(e).__name__}: {e}', file=sys.stderr)
        finally:
            signal.alarm(0)
        out.append({'found': len(at), 'timedOut': timed_out, 'failed': failed, 'refs': found})
    return {'specs': out}


def names(req):
    """The words the file names in code (comments and strings left out), and the words of
    `resolve` it names somewhere jedi cannot follow to any declaration (an attribute of a value
    it cannot infer)."""
    words = set(req['words'])
    resolve = set(req.get('resolve', []))
    path = os.path.join(req['root'], req['file'])
    at = []
    try:
        with open(path, 'rb') as f:
            at = [(t.string, t.start) for t in tokenize.tokenize(f.readline) if t.type == tokenize.NAME and t.string in words]
    except (tokenize.TokenError, SyntaxError):
        pass
    unresolved = set()
    signal.alarm(req.get('timeout', 20))
    try:
        script = jedi.Script(path=path, project=project_of(req['root'], req.get('paths', [])), environment=ENVIRONMENT)
        # tokenize counts columns in characters, as jedi does; 5 places are enough to say
        for word, (line, column) in [(w, p) for w, p in at if w in resolve][:5]:
            if word not in unresolved and not script.goto(line, column, follow_imports=True):
                unresolved.add(word)
    except Timeout:
        unresolved.update(w for w, _ in at if w in resolve)
    except Exception as e:
        print(f'pyrefs: names {req["file"]}: {type(e).__name__}: {e}', file=sys.stderr)
    finally:
        signal.alarm(0)
    return {'named': sorted({w for w, _ in at}), 'unresolved': sorted(unresolved)}


def module_of(rel, paths):
    """`a/b/c.py` as `a.b.c`, from the deepest sys.path folder that holds it."""
    for base in sorted(paths, key=len, reverse=True):
        prefix = '' if base == '' else base.rstrip('/') + '/'
        if rel.startswith(prefix):
            parts = rel[len(prefix):][:-3].split('/')
            return '.'.join(parts[:-1] if parts[-1] == '__init__' else parts)
    return None


def imports(req):
    """Whether `file` names `target`'s module in an import statement of its own."""
    paths = req.get('paths', []) + ['']
    target = module_of(req['target'], paths)
    here = module_of(req['file'], paths) or ''
    package = here.split('.') if req['file'].endswith('__init__.py') else here.split('.')[:-1]
    tree, _ = tree_of(os.path.join(req['root'], req['file']))
    named = set()
    for node in ast.walk(tree) if tree is not None else []:
        if isinstance(node, ast.Import):
            named.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ''
            if node.level > 0:
                base = '.'.join(package[:len(package) - node.level + 1] + ([base] if base else []))
            named.add(base)
            named.update(f'{base}.{a.name}' for a in node.names)
    return {'imports': target in named}


OPS = {'refs': refs, 'names': names, 'imports': imports}

for raw in sys.stdin:
    req = json.loads(raw)
    sys.stdout.write(json.dumps(OPS[req['op']](req)) + '\n')
    sys.stdout.flush()
