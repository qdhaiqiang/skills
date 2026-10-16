#!/usr/bin/env python3
"""按色相规则定位实心色块（按钮），输出连通块包围盒。

用法: findcolor.py FRAME RULE [最小面积]
  RULE: green | blue | red | yellow | purple
"""
import subprocess, sys

RULES = {
    'green':  '(g-r>0.10 && g-b>0.10)',
    'blue':   '(b-r>0.12 && b-g>0.06)',
    'red':    '(r-g>0.12 && r-b>0.08)',
    'yellow': '(r-b>0.15 && g-b>0.15 && r>0.6)',
    'purple': '(b-r>0.05 && r-g>0.10)',
}

frame, rule = sys.argv[1], sys.argv[2]
min_area = int(sys.argv[3]) if len(sys.argv) > 3 else 500
subprocess.run(['magick', frame, '-colorspace', 'sRGB', '-fx', RULES[rule] + ' ? 1 : 0', '/tmp/_mask.png'], check=True)
out = subprocess.run(['magick', '/tmp/_mask.png', '-define', 'connected-components:verbose=true',
                      '-define', 'connected-components:area-threshold=%d' % min_area,
                      '-threshold', '50%', '-connected-components', '8', 'null:'],
                     capture_output=True, text=True).stdout
for line in out.splitlines():
    if 'gray(255)' in line:
        parts = line.split()
        print(parts[1], 'area=' + (parts[3] if len(parts) > 3 else '?'))
