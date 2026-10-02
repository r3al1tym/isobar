"""grimp's import graph of one package, as repo-relative file edges, printed as JSON.

    python bench/pygraph.py <repo> <package> [<path on sys.path, relative to repo>]

Also lists, per file, the line of every import statement in its AST, so a matched line
that is no import (a docstring, a comment) can be told apart.
"""
import ast
import json
import os
import sys

import grimp

repo, package = sys.argv[1], sys.argv[2]
base = os.path.join(repo, sys.argv[3] if len(sys.argv) > 3 else '')
sys.path.insert(0, base)

# grimp skips folders of modules with no __init__.py (flask's sansio/), so name them as packages too.
root = os.path.join(base, package)
portions = [
    os.path.relpath(d, base).replace(os.sep, '.')
    for d, _, files in os.walk(root)
    if d != root and '__init__.py' not in files and any(f.endswith('.py') for f in files)
]
graph = grimp.build_graph(package, *portions, include_external_packages=False, cache_dir=None)


def file_of(module):
    stem = os.path.join(base, *module.split('.'))
    for path in (stem + '.py', os.path.join(stem, '__init__.py')):
        if os.path.isfile(path):
            return os.path.relpath(path, repo)
    return None


edges = []
for importer in sorted(graph.modules):
    for imported in sorted(graph.find_modules_directly_imported_by(importer)):
        details = graph.get_import_details(importer=importer, imported=imported)
        first = min(details, key=lambda d: d['line_number']) if details else {'line_number': 0, 'line_contents': ''}
        a, b = file_of(importer), file_of(imported)
        if a and b:
            edges.append([a, b, first['line_number'], first['line_contents']])

import_lines = {}
for module in graph.modules:
    path = file_of(module)
    if path is None:
        continue
    try:
        tree = ast.parse(open(os.path.join(repo, path), encoding='utf-8').read())
    except (SyntaxError, TypeError, OSError):
        continue
    import_lines[path] = sorted({n.lineno for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))})

print(json.dumps({'grimp': grimp.__version__, 'modules': len(graph.modules), 'portions': portions, 'edges': edges, 'importLines': import_lines}))
