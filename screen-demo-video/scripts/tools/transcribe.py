#!/usr/bin/env python
"""用 faster-whisper 从第四集原声里转出带真实时间码的中文句子。"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

src = Path(sys.argv[1] if len(sys.argv) > 1 else "videos/ep4-tour/assets/audio/original.wav")
out = Path(sys.argv[2] if len(sys.argv) > 2 else "videos/ep4-tour/build/transcript.json")
size = sys.argv[3] if len(sys.argv) > 3 else "small"

# 本机 PyAV 19 与 faster-whisper 的 av.open(metadata_errors=...) 不兼容，
# 改为自行用 soundfile 解码成 16k float32 数组再喂给模型。
audio, sr = sf.read(str(src), dtype="float32")
if audio.ndim > 1:
    audio = audio.mean(axis=1)
if sr != 16000:
    n = int(len(audio) * 16000 / sr)
    audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype("float32")
audio = np.ascontiguousarray(audio)

model = WhisperModel(size, device="cpu", compute_type="int8", cpu_threads=8)
segments, info = model.transcribe(
    audio,
    language="zh",
    beam_size=5,
    word_timestamps=True,
    initial_prompt="以下是关于 PLC 代码仓库、提交详情页、工程可视化差异、合并请求的中文讲解。",
    vad_filter=True,
    vad_parameters={"min_silence_duration_ms": 300},
)

rows = []
for seg in segments:
    rows.append(
        {
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
            "words": [
                {"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word}
                for w in (seg.words or [])
            ],
        }
    )
    print(f"[{seg.start:7.2f} -> {seg.end:7.2f}] {seg.text.strip()}", flush=True)

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"language": info.language, "duration": info.duration, "segments": rows}, ensure_ascii=False, indent=2))
print(f"\n共 {len(rows)} 句 -> {out}")
