#!/usr/bin/env python
"""按 silencedetect 结果统计"语音窗口"的 RMS 与峰值，用于反推固定增益。

用法: speech-level.py <wav> [noise阈值dB] [最短静音秒]
"""
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

src = sys.argv[1]
thr = sys.argv[2] if len(sys.argv) > 2 else "-45dB"
dur = sys.argv[3] if len(sys.argv) > 3 else "0.35"

out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', src,
                      '-af', f'silencedetect=noise={thr}:d={dur}', '-f', 'null', '-'],
                     capture_output=True, text=True).stderr
starts = [float(v) for v in re.findall(r'silence_start:\s*([\d.]+)', out)]
ends = [float(v) for v in re.findall(r'silence_end:\s*([\d.]+)', out)]

audio, sr = sf.read(src, dtype='float32')
if audio.ndim > 1:
    audio = audio.mean(axis=1)

# 静音区间取补集即为语音区间
spans, cursor = [], 0.0
for s, e in zip(starts, ends):
    if s > cursor:
        spans.append((cursor, s))
    cursor = max(cursor, e)
if cursor < len(audio) / sr:
    spans.append((cursor, len(audio) / sr))
spans = [(a, b) for a, b in spans if b - a >= 0.2]

seg = np.concatenate([audio[int(a * sr):int(b * sr)] for a, b in spans])
rms = 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12)
peak = 20 * np.log10(np.max(np.abs(seg)) + 1e-12)
talk = sum(b - a for a, b in spans)
print(f'语音窗口 {len(spans)} 段 共 {talk:.1f}s / {len(audio) / sr:.1f}s')
print(f'语音 RMS {rms:.1f} dBFS · 峰值 {peak:.1f} dBFS')
print(f'建议固定增益 {( -19.5 - rms):+.1f} dB（把语音 RMS 抬到 −19.5 dBFS）')
