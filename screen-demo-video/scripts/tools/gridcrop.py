#!/usr/bin/env python3
"""裁剪源帧并叠加源像素坐标网格，用于直接读出控件位置。

用法: gridcrop.py FRAME X Y W H STEP OUT [SCALE=1]
  STEP = 网格间隔(源像素)；SCALE = 输出放大倍数。
"""
import subprocess
import sys

FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
frame, x0, y0, w, h, step, out = sys.argv[1], *(int(v) for v in sys.argv[2:7]), sys.argv[7]
scale = float(sys.argv[8]) if len(sys.argv) > 8 else 1.0

args = ["magick", frame, "-crop", f"{w}x{h}+{x0}+{y0}", "+repage"]
if scale != 1.0:
    args += ["-filter", "point", "-resize", f"{int(w * scale)}x{int(h * scale)}!"]
args += ["-font", FONT, "-stroke", "#ff0000", "-strokewidth", "1"]
for gx in range(0, w + 1, step):
    px = gx * scale
    args += ["-draw", f"line {px:.0f},0 {px:.0f},{h * scale}"]
for gy in range(0, h + 1, step):
    py = gy * scale
    args += ["-draw", f"line 0,{py:.0f} {w * scale},{py:.0f}"]
args += ["-stroke", "none", "-fill", "#ff0000"]
for gx in range(0, w + 1, step):
    for gy in range(0, h + 1, step):
        args += ["-annotate", f"+{gx * scale + 3:.0f}+{gy * scale + 16:.0f}",
                 f"{x0 + gx},{y0 + gy}"]
args.append(out)
subprocess.run(args, check=True)
print(out)
