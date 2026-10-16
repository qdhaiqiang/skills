#!/usr/bin/env python3
"""按区域测量帧内容，用于校验放大位/标注框是否落在真实文字或控件上。

用法:
  measure.py ink  FRAME X Y W H [FUZZ]   # 区域内非白像素占比(0~1)，含灰字与彩色胶囊
  measure.py box  FRAME X Y W H [FUZZ]   # 非白内容包围盒 (x, y, w, h)
  measure.py dark FRAME X Y W H [THR]    # 深色像素包围盒(纯文字更准)
  measure.py color FRAME HEX [FUZZ]      # 整帧内该颜色的包围盒(主色按钮/标签)
坐标均为 4480x2520 源像素。
"""
import re
import subprocess
import sys

OFF = re.compile(r'(-?\d+)(-?\d+)')


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def geo_of(out, base_x, base_y):
    match = re.match(r'(\d+)x(\d+)', out)
    if not match or min(int(match.group(1)), int(match.group(2))) <= 2:
        return None
    ww, hh = int(match.group(1)), int(match.group(2))
    offsets = OFF.findall(out[match.end():])
    ox, oy = (int(offsets[0][0]), int(offsets[0][1])) if offsets else (0, 0)
    return (base_x + ox, base_y + oy, ww, hh)


def crop(path, x, y, w, h):
    return ['magick', path, '-crop', f'{w}x{h}+{x}+{y}', '+repage']


def nonwhite(path, x, y, w, h, fuzz='12%'):
    return crop(path, x, y, w, h) + ['-fuzz', fuzz, '-transparent', '#ffffff']


def ink(path, x, y, w, h, fuzz='12%'):
    out = run(nonwhite(path, x, y, w, h, fuzz) + ['-alpha', 'extract', '-format', '%[fx:mean]', 'info:'])
    try:
        return round(float(out), 4)
    except ValueError:
        return None


def box(path, x, y, w, h, fuzz='12%'):
    out = run(nonwhite(path, x, y, w, h, fuzz) + ['-bordercolor', '#ffffff', '-border', '1', '-trim', '-format', '%wx%h%O', 'info:'])
    return geo_of(out, x, y)


def dark(path, x, y, w, h, thr='62%'):
    out = run(crop(path, x, y, w, h) + ['-colorspace', 'gray', '-threshold', thr, '-bordercolor', 'white',
                                        '-border', '1', '-trim', '-format', '%wx%h%O', 'info:'])
    return geo_of(out, x, y)


def color(path, hexcolor, fuzz='6%'):
    out = run(['magick', path, '-fuzz', fuzz, '-fill', '#ffffff', '+opaque', hexcolor,
               '-bordercolor', '#ffffff', '-border', '1', '-trim', '-format', '%wx%h%O', 'info:'])
    return geo_of(out, 0, 0)


if __name__ == '__main__':
    mode, path = sys.argv[1], sys.argv[2]
    if mode == 'color':
        print(color(path, sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else '6%'))
        sys.exit(0)
    x, y, w, h = (int(v) for v in sys.argv[3:7])
    extra = sys.argv[7] if len(sys.argv) > 7 else None
    print({'ink': ink, 'box': box}.get(mode, dark)(path, x, y, w, h, extra or ('12%' if mode != 'dark' else '62%')))
