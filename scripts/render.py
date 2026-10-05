"""Renders a sheet grid (JSON from preview.ts) to PNG the way a truecolor terminal draws it.

Half blocks and box-drawing lines are drawn as geometry, as terminals do; text uses a
monospace font. A dark margin stands in for the terminal around the docked pane.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

CW, CH = 10, 21
MARGIN = 24
DOCK = (38, 38, 38)


def font():
    """The first monospace font there is: $ISOBAR_FONT, DejaVu Sans Mono (Linux), Menlo (macOS), DejaVu by name, then Pillow's own.

    Text is drawn one glyph a cell, so any monospace face keeps the grid.
    """
    for path in (os.environ.get('ISOBAR_FONT'), '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/System/Library/Fonts/Menlo.ttc', 'DejaVuSansMono.ttf'):
        if not path:
            continue
        try:
            return ImageFont.truetype(path, 16)
        except OSError:
            pass
    return ImageFont.load_default(size=16)


FONT = font()

# A preview snaps colours to 4 bits a channel, as the Raster does; a live capture is already snapped.
SNAP = len(sys.argv) < 4 or sys.argv[3] != '0'

def rgb(c):
    ch = tuple(((c >> s) & 255) for s in (16, 8, 0))
    return tuple(round(v / 17) * 17 for v in ch) if SNAP else ch

def main(src, dst):
    grid = json.load(open(src))
    cols, rows = grid['cols'], grid['rows']
    im = Image.new('RGB', (cols * CW + 2 * MARGIN, rows * CH + 2 * MARGIN), DOCK)
    d = ImageDraw.Draw(im)
    for i, cell in enumerate(grid['cells']):
        x = MARGIN + (i % cols) * CW
        y = MARGIN + (i // cols) * CH
        g, fg, bg = cell['glyph'], rgb(cell['fg']), rgb(cell['bg'])
        d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=bg)
        mx, my = x + CW // 2, y + CH // 2
        if g == '▀':
            d.rectangle([x, y, x + CW - 1, y + CH // 2 - 1], fill=fg)
        elif g in '─┌┐└┘├┤┬┴┼│╭╮╰╯':
            up = g in '│└┘├┤┴┼╰╯'
            down = g in '│┌┐├┤┬┼╭╮'
            left = g in '─┐┘┤┬┴┼╮╯'
            right = g in '─┌└├┬┴┼╭╰'
            if up: d.line([mx, y, mx, my], fill=fg)
            if down: d.line([mx, my, mx, y + CH - 1], fill=fg)
            if left: d.line([x, my, mx, my], fill=fg)
            if right: d.line([mx, my, x + CW - 1, my], fill=fg)
        elif 0x2800 <= ord(g) <= 0x28ff:
            # braille, drawn as dots the way terminals draw it
            bits = ord(g) - 0x2800
            order = [(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2), (0, 3), (1, 3)]
            for b, (cx, cy) in enumerate(order):
                if bits & (1 << b):
                    px = x + 2 + cx * 5
                    py = y + 2 + cy * 5
                    d.rectangle([px, py, px + 1, py + 1], fill=fg)
        elif g != ' ':
            d.text((x, y + 1), g, font=FONT, fill=fg)
    im.save(dst)
    print(dst, im.size)

main(sys.argv[1], sys.argv[2])
