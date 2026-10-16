#!/usr/bin/env python3
"""在指定矩形内定位彩色标签胶囊（饱和度高的色块），返回包围盒与聚类。

用法: pill.py FRAME X Y W H [MODE]
  MODE: sat  任意高饱和色块（红/绿/蓝/橙标签底）
        red  红色系 (r 明显高于 g,b)
        blue 蓝色系 (b 明显高于 r)
"""
import re
import subprocess
import sys

frame, x0, y0, w, h = sys.argv[1], *(int(v) for v in sys.argv[2:6])
mode = sys.argv[6] if len(sys.argv) > 6 else 'sat'
out = subprocess.run(['magick', frame, '-crop', f'{w}x{h}+{x0}+{y0}', '+repage', 'txt:-'],
                     capture_output=True, text=True).stdout


def pred(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    if mode == 'red':
        return r > 140 and r - g > 45 and r - b > 30
    if mode == 'blue':
        return b > 120 and b - r > 35
    return mx - mn > 70 and mx > 110


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
    """按间隔聚类，返回每簇 (min, max, 点数)。"""
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
print('y-groups:', groups(ys, 20))
for gy0, gy1, _n in groups(ys, 20):
    sub = sorted(p[0] for p in pts if gy0 <= p[1] <= gy1)
    print(f'  y[{gy0}..{gy1}] x-groups:', groups(sub, 20))
