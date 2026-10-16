// "有声但没字幕"扫描：用 ffmpeg silencedetect 求成片里的有声区间，再与字幕窗口取反。
// 用法: node scan-voice.mjs <合成工程目录> <成片.mp4>
// 注意：不要自己按 -ar 100 算 RMS——100Hz 重采样会把语音整段低通滤掉（实测同一秒差 70dB）。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = (process.argv[2] ?? '.').replace(/\/$/, '');
const film = process.argv[3] ?? null;
const { plan } = await import(new URL(`file://${process.cwd()}/${root}/build/plan.mjs`).href);
const target = film ?? `${root}/../${plan.filmName}`;
const tidy = (t) => t.replace(/,/g, '，').replace(/:/g, '：');
const polish = (t) => Object.entries(plan.textPolish ?? {}).reduce((s, [a, b]) => s.split(a).join(b), t);
const sameBase = (span) => span.transcript === plan.baseTranscript;

// 复刻合成里的字幕窗口（整句用句子时间；有停顿的句子按 cueSplit 拆成子窗口）。
const windows = [];
let offset = 0;
for (const span of plan.spans) {
  const base = plan.titleSeconds + offset;
  offset += span.out - span.in;
  const transcript = JSON.parse(readFileSync(`${root}/${span.transcript}`, 'utf8'));
  transcript.segments.forEach((seg, index) => {
    if (seg.end <= span.in || seg.start >= span.out) return;
    const id = `${span.id}${String(index + 1).padStart(2, '0')}`;
    const split = plan.cueSplit?.[id] ?? (sameBase(span) ? plan.cueSplitByIdx?.[index + 1] : null);
    const text = polish(tidy(plan.textFix?.[id] ?? (sameBase(span) ? plan.textFixByIdx?.[index + 1] : null) ?? seg.text));
    for (const c of split ?? [[seg.start, seg.end]]) {
      windows.push([base + c[0] - span.in - 0.06, base + c[1] - span.in + 0.4, text.slice(0, 14)]);
    }
  });
}

const sd = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', target, '-af', 'silencedetect=noise=-30dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr;
const starts = [...sd.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
const ends = [...sd.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
const audible = [];
for (const e of ends) {
  const s = starts.filter((x) => x < e).pop();
  if (s !== undefined && e - s > 0.4) audible.push([s, e]);
}
const covered = (a, b) => windows.some((w) => (a + b) / 2 >= w[0] - 0.35 && (a + b) / 2 <= w[1] + 0.35);

let flagged = 0;
for (const [a, b] of audible) {
  if (!covered(a, b)) {
    flagged += 1;
    console.log(`!! ${a.toFixed(2)}s→${b.toFixed(2)}s 有声但不在任何字幕窗口内`);
  }
}
console.log(`字幕窗口 ${windows.length} 条 · 有声区间 ${audible.length} 段 · 待确认 ${flagged} 处`);
console.log('对每一处：把源音频同秒切片重跑 ASR（见 references/verification.md）。返回"无语音"即为键盘/鼠标声，可放行。');
