#!/usr/bin/env python3
"""按行/列扫描帧内文字分布，用于把放大框对齐到真实文本行。

用法: rowscan.py FRAME X Y W H [MININK=0.02] [col]
  默认按行扫描（输出 y 区间）；给 col 则按列扫描（输出 x 区间）。
坐标为 4480x2520 源像素。
"""
import re
import subprocess
import sys


def profile(frame, x, y, w, h, axis):
    size = f"{w}x1!" if axis == "col" else f"1x{h}!"
    out = subprocess.run(
        ["magick", frame, "-crop", f"{w}x{h}+{x}+{y}", "+repage", "-colorspace", "gray", "-negate", "-resize", size, "txt:-"],
        capture_output=True,
        text=True,
    ).stdout
    vals = []
    for line in out.splitlines():
        hit = re.search(r"\(([\d.]+),[\d.]*\)\s*#", line) or re.search(r"gray\(([\d.]+)%\)", line)
        vals.append(float(hit.group(1)) / 100 if hit else 0.0)
    return vals


def bands(vals, offset, minink, mingap=6, minlen=6):
    res = []
    start = prev = None
    for i, v in enumerate(vals):
        if v >= minink:
            if start is None:
                start = i
            prev = i
        else:
            if start is not None and prev - start >= minlen:
                res.append((offset + start, offset + prev))
            start = None
    if start is not None:
        res.append((offset + start, offset + prev))
    return res


if __name__ == "__main__":
    frame, x, y, w, h = sys.argv[1], *(int(v) for v in sys.argv[2:6])
    minink = float(sys.argv[6]) if len(sys.argv) > 6 else 0.02
    axis = sys.argv[7] if len(sys.argv) > 7 else "row"
    vals = profile(frame, x, y, w, h, axis)
    base = x if axis == "col" else y
    span = w if axis == "col" else h
    for a, b in bands(vals, base, minink):
        print(f"{a}-{b}  (len {b - a})")
