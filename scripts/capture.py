"""capture.py <tmux-session> <out.png>: a live terminal, cell for cell, to PNG.

Reads `tmux capture-pane -e -N`, parses its SGR colours (truecolor, 256 and the
Campbell 16, Windows Terminal's default scheme) into the grid JSON render.py draws,
so the live capture and the preview share one renderer.
"""
import json
import re
import subprocess
import sys

CAMPBELL = [(12, 12, 12), (197, 15, 31), (19, 161, 14), (193, 156, 0), (0, 55, 218), (136, 23, 152), (58, 150, 221), (204, 204, 204),
            (118, 118, 118), (231, 72, 86), (22, 198, 12), (249, 241, 165), (59, 120, 255), (180, 0, 158), (97, 214, 214), (242, 242, 242)]
FG, BG = (204, 204, 204), (12, 12, 12)
SGR = re.compile(r'\x1b\[([0-9;:]*)m')
OTHER = re.compile(r'\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-ln-z]')

def xterm256(n):
    if n < 16:
        return CAMPBELL[n]
    if n < 232:
        n -= 16
        steps = [0, 95, 135, 175, 215, 255]
        return (steps[n // 36], steps[(n // 6) % 6], steps[n % 6])
    v = 8 + 10 * (n - 232)
    return (v, v, v)

def pack(c):
    return (c[0] << 16) | (c[1] << 8) | c[2]

def parse(raw, cols):
    rows = []
    for line in raw.rstrip('\n').split('\n'):
        line = OTHER.sub('', line)
        fg, bg, rev, dim = FG, BG, False, False
        cells, i = [], 0
        while i < len(line):
            m = SGR.match(line, i)
            if m:
                ps = [int(p) if p else 0 for p in re.split('[;:]', m.group(1) or '0')]
                k = 0
                while k < len(ps):
                    p = ps[k]
                    if p == 0: fg, bg, rev, dim = FG, BG, False, False
                    elif p == 2: dim = True
                    elif p == 22: dim = False
                    elif p == 7: rev = True
                    elif p == 27: rev = False
                    elif 30 <= p <= 37: fg = CAMPBELL[p - 30]
                    elif 90 <= p <= 97: fg = CAMPBELL[p - 82]
                    elif 40 <= p <= 47: bg = CAMPBELL[p - 40]
                    elif 100 <= p <= 107: bg = CAMPBELL[p - 92]
                    elif p == 39: fg = FG
                    elif p == 49: bg = BG
                    elif p in (38, 48) and k + 1 < len(ps):
                        if ps[k + 1] == 5 and k + 2 < len(ps):
                            col = xterm256(ps[k + 2]); k += 2
                        elif ps[k + 1] == 2 and k + 4 < len(ps):
                            col = tuple(ps[k + 2:k + 5]); k += 4
                        else:
                            col = FG if p == 38 else BG
                        if p == 38: fg = col
                        else: bg = col
                    k += 1
                i = m.end()
                continue
            ch = line[i]
            f, b = (bg, fg) if rev else (fg, bg)
            if dim: f = tuple((a + c) // 2 for a, c in zip(f, b))
            cells.append({'glyph': ch, 'fg': pack(f), 'bg': pack(b)})
            i += 1
        cells = cells[:cols] + [{'glyph': ' ', 'fg': pack(FG), 'bg': pack(BG)}] * (cols - len(cells))
        rows.append(cells)
    return rows

def main(session, out):
    cols = int(subprocess.run(['tmux', 'display', '-p', '-t', session, '#{pane_width}'], capture_output=True, text=True).stdout)
    raw = subprocess.run(['tmux', 'capture-pane', '-t', session, '-p', '-e', '-N'], capture_output=True, text=True).stdout
    rows = parse(raw, cols)
    json.dump({'cols': cols, 'rows': len(rows), 'cells': [c for r in rows for c in r]}, open(out + '.json', 'w'))
    subprocess.run([sys.executable, __file__.replace('capture.py', 'render.py'), out + '.json', out, '0'])

main(sys.argv[1], sys.argv[2])
