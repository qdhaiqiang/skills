// 逐拍能量自检：把每个 span 内的原声/旁白句子时间码换算到成片时间轴，逐句量均值与峰值。
// 用法: node verify-beats.mjs <合成工程目录> <成片.mp4>
// 判据：旁白句均值应明显高于纯铺底（实测合格线 均值 > -27dB 且峰值 > -12dB）；
//      若某句均值反而低于铺底窗口，说明该句人声没混进去（见 references/verification.md）。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [rootArg, film] = [process.argv[2] ?? '.', process.argv[3] ?? null];
const root = rootArg.replace(/\/$/, '');
const { plan } = await import(new URL(`file://${process.cwd()}/${root}/build/plan.mjs`).href);
const target = film ?? `${root}/../${plan.filmName}`;

const level = (ss, t) => {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(ss), '-t', String(t), '-i', target, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const mean = /mean_volume:\s*(-[\d.]+) dB/.exec(out);
  const max = /max_volume:\s*(-[\d.]+) dB/.exec(out);
  return { mean: mean ? Number(mean[1]) : NaN, max: max ? Number(max[1]) : NaN };
};

let offset = 0;
let bad = 0;
let total = 0;
const windows = [];
for (const span of plan.spans) {
  const transcript = JSON.parse(readFileSync(`${root}/${span.transcript}`, 'utf8'));
  const base = plan.titleSeconds + offset;
  offset += span.out - span.in;
  for (const [k, seg] of transcript.segments.entries()) {
    // 同一条转写可被多个窗口复用；落在窗口外的句子不进本片，不参与自检。
    if (seg.end <= span.in || seg.start >= span.out) continue;
    const start = base + Math.max(0, seg.start - span.in);
    const dur = Math.min(span.out, seg.end) - Math.max(span.in, seg.start);
    windows.push([start, start + dur]);
    const { mean, max } = level(start, dur);
    const ok = mean > -27 && max > -12;
    if (!ok) bad += 1;
    total += 1;
    console.log(`${ok ? 'OK ' : '!! '} ${span.id}${String(k + 1).padStart(2, '0')} 成片${start.toFixed(2)}→${(start + dur).toFixed(2)} 均值${mean.toFixed(1)}dB 峰值${max.toFixed(1)}dB  ${seg.text.slice(0, 22)}`);
  }
}
// 纯铺底窗口：没有任何句子的区间，应与旁白窗口明显更轻（实测 -34 ~ -37dB）。
let at = plan.titleSeconds;
for (const [a, b] of windows.sort((x, y) => x[0] - y[0])) {
  if (a - at > 2) {
    const { mean } = level(at, Math.min(4, a - at));
    console.log(`铺底 ${at.toFixed(2)}→${a.toFixed(2)} 均值${mean.toFixed(1)}dB`);
  }
  at = Math.max(at, b);
}
const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', target], { encoding: 'utf8' }).stdout.trim();
console.log(`成片时长 ${Number(dur).toFixed(2)}s · 原声窗口 ${total} 句 · 异常 ${bad} 句`);
