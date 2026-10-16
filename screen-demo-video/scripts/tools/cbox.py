#!/usr/bin/env python3
"""在指定矩形内按颜色谓词定位控件包围盒（源像素 4480x2520）。

用法: cbox.py FRAME X Y W H PREDICATE
  PREDICATE: blue   蓝色文字/边框 (b 明显大于 r)
             green  绿色文字/边框 (g 明显大于 r,b)
             solid  深色实心控件底 (三通道都不高)
"""
import re
import subprocess
import sys

frame, x0, y0, w, h, mode = sys.argv[1], *(int(v) for v in sys.argv[2:6]), sys.argv[6]
out = subprocess.run(['magick', frame, '-crop', f'{w}x{h}+{x0}+{y0}', '+repage', 'txt:-'],
                     capture_output=True, text=True).stdout


def pred(r, g, b):
    if mode == 'blue':
        return b > 110 and b - r > 35
    if mode == 'green':
        return g > 90 and g - r > 30 and g - b > 30
    return r < 130 and g < 130 and b < 130


pts = []
for line in out.splitlines():
    m = re.match(r'(\d+),(\d+): \((\d+),(\d+),(\d+)', line)
    if m:
        px, py, r, g, b = (int(v) for v in m.groups())
        if pred(r, g, b):
            pts.append((px + x0, py + y0))
if not pts:
    print('none')
    sys.exit(0)
def groups(vals, gap):
    """按间隔聚类，返回每簇 (min, max, 点数)，用于区分多个同色控件。"""
    res, cur = [], [vals[0]]
    for v in vals[1:]:
        if v - cur[-1] > gap:
            res.append(cur)
            cur = [v]
        else:
            cur.append(v)
    res.append(cur)
    return [(c[0], c[-1], len(c)) for c in res]


xs = sorted(p[0] for p in pts)
ys = sorted(p[1] for p in pts)
print(f'bbox x {xs[0]}..{xs[-1]} y {ys[0]}..{ys[-1]}  n={len(pts)}')
print('x-groups:', groups(xs, 25))
print('y-groups:', groups(ys, 25))
for gx0, gx1, _n in groups(xs, 25):
    sub = sorted(p[1] for p in pts if gx0 <= p[0] <= gx1)
    print(f'  x[{gx0}..{gx1}] y-groups:', groups(sub, 25))

