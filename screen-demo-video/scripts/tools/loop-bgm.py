"""把 assets/bgm/track.wav 交叉淡化循环加长到目标秒数（与 media-use 的 seed-loop 同一算法）。

用法: python loop-bgm.py <输入 wav> <输出 wav> <目标秒数>
"""
import math
import sys
import numpy as np
import soundfile as sf

src, dst, target_s = sys.argv[1], sys.argv[2], float(sys.argv[3])
data, sr = sf.read(src, dtype="float32", always_2d=True)
seed = data[:, 0]
want = int(round(target_s * sr))

def loop_crossfade(seed, target_len, xf):
    if seed.shape[0] >= target_len:
        return seed[:target_len]
    xf = min(xf, seed.shape[0] // 2)
    t = np.linspace(0.0, 1.0, xf, dtype="float32")
    fade_out = np.cos(t * (math.pi / 2))
    fade_in = np.sin(t * (math.pi / 2))
    out = seed.copy()
    while out.shape[0] < target_len:
        tail = out[-xf:] * fade_out
        head = seed[:xf] * fade_in
        out = np.concatenate([out[:-xf], tail + head, seed[xf:]])
    return out[:target_len]

xf = int(round(0.3 * sr))
final = loop_crossfade(seed, want, xf)
peak = float(np.max(np.abs(final)))
if peak > 1.0:
    final = final / peak
sf.write(dst, final, sr)
print(f"wrote {dst} dur={final.shape[0] / sr:.2f}s sr={sr}")
