// 音质对照量具：量"停顿底噪 / 低频隆隆指数 / 语音亮度 / 语音响度"，用于比较音频处理链。
// 用法: node videos/work/audio-metrics.mjs <转写json> <语音起点覆盖秒> <音频1> [音频2 ...]
// 每个音频文件都按同一批句子与停顿窗口测量，直接横向对比。
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { argv } from 'node:process';

const [, , transcriptPath, trimFromArg, ...files] = argv;
const trimFrom = Number(trimFromArg ?? 0);
const segs = JSON.parse(readFileSync(transcriptPath, 'utf8')).segments;
const SR = 48000;

// 语音窗口与停顿窗口（停顿 = 相邻句子之间 >1.2s 的间隙，取中间部分）
const speech = segs.map((s) => [s.start - trimFrom, s.end - trimFrom]).filter(([a]) => a >= 0);
const pauses = [];
for (let i = 1; i < segs.length; i += 1) {
  const gap = segs[i].start - segs[i - 1].end;
  if (gap > 1.2) pauses.push([segs[i - 1].end + 0.25 - trimFrom, segs[i].start - 0.25 - trimFrom]);
}

// 用 ffmpeg 把区间导出成裸 f32 单声道，再在 JS 里做 FFT（避免依赖 python 环境）
const decode = (file, a, b) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, a)), '-t', String(b - a), '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28, encoding: null });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, (r.stdout.length / 4) | 0);
};

// 平均功率谱（汉宁窗、4096 点）
function spectrum(samples) {
  const n = 4096;
  const acc = new Float64Array(n / 2 + 1);
  const win = new Float64Array(n);
  for (let i = 0; i < n; i += 1) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  let frames = 0;
  for (let j = 0; j + n < samples.length; j += n / 2) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i += 1) { re[i] = samples[j + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= n / 2; k += 1) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames += 1;
  }
  for (let k = 0; k <= n / 2; k += 1) acc[k] = acc[k] / Math.max(1, frames);
  return { acc, frames };
}

// 迭代式 radix-2 FFT（就地）
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI / len) * 1;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const db = (x) => 10 * Math.log10(x + 1e-20);
// 传入"若干段样本数组"，逐段累加平方和，避免一次性展开成超大数组。
const rmsDb = (chunks) => {
  let sum = 0, n = 0, peak = 0;
  for (const c of chunks) { for (let i = 0; i < c.length; i += 1) { const v = c[i]; sum += v * v; n += 1; if (Math.abs(v) > peak) peak = Math.abs(v); } }
  return { db: 20 * Math.log10(Math.sqrt(sum / Math.max(1, n)) + 1e-12), n, peak };
};
const bandDb = (acc, lo, hi) => {
  const n = (acc.length - 1) * 2;
  let sum = 0;
  for (let k = 0; k < acc.length; k += 1) { const f = (k * SR) / n; if (f >= lo && f < hi) sum += acc[k]; }
  return db(sum);
};

for (const file of files) {
  const sp = speech.map(([a, b]) => decode(file, a, b)).filter((x) => x.length > 4096);
  const pz = pauses.map(([a, b]) => decode(file, a, b)).filter((x) => x.length > 4096);
  if (!sp.length) { console.log(`${file}: 没有可用语音窗口`); continue; }
  const sSpec = sp.map(spectrum);
  const pSpec = pz.length ? pz.map(spectrum) : sSpec;
  const mix = (list) => {
    const out = new Float64Array(list[0].acc.length);
    let frames = 0;
    for (const s of list) { for (let k = 0; k < out.length; k += 1) out[k] += s.acc[k]; frames += s.frames; }
    for (let k = 0; k < out.length; k += 1) out[k] /= Math.max(1, frames);
    return out;
  };
  const S = mix(sSpec);
  const P = mix(pSpec);
  const sv = rmsDb(sp);
  const pv = rmsDb(pz.length ? pz : sp);
  console.log(`\n== ${file}`);
  console.log(`   语音 RMS ${sv.db.toFixed(1)} dBFS · 峰值 ${sv.peak.toFixed(3)} · 停顿底噪 RMS ${pv.db.toFixed(1)} dBFS · 样本 ${sv.n}`);
  const BANDS = [[20, 60], [60, 120], [120, 250], [250, 500], [500, 1e3], [1e3, 2e3], [2e3, 4e3], [4e3, 8e3]];
  const fmt = (acc) => BANDS.map(([lo, hi]) => `${lo >= 1000 ? `${lo / 1000}k` : lo}-${hi >= 1000 ? `${hi / 1000}k` : hi}:${bandDb(acc, lo, hi).toFixed(1)}`).join(' ');
  console.log(`   语音频谱 ${fmt(S)}`);
  console.log(`   停顿频谱 ${fmt(P)}`);
  const low = bandDb(P, 20, 120);
  const mid = bandDb(P, 250, 1000);
  const bright = bandDb(S, 2000, 8000) - bandDb(S, 120, 2000);
  console.log(`   隆隆指数(停顿 20-120 − 250-1k) ${(low - mid).toFixed(1)} dB · 亮度(语音 2-8k − 0.12-2k) ${bright.toFixed(1)} dB · 底噪−语音 ${(pv.db - sv.db).toFixed(1)} dB`);
}
