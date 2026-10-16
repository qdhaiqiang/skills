// 由"已滤波但未加音量"的语音轨反推固定增益：让语音段 RMS 命中目标，同时保证峰值余量。
// 用法: node tune-voice.mjs <已处理wav> <转写json> [目标RMS=-19.5] [峰值上限dB=-1.5]
// 输出：需要补的 dB 数（直接接 volume=<n>dB）。稀疏语音不要用 loudnorm（会把底噪灌进静音）。
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [wav, transcriptPath, targetArg = '-19.5', headroomArg = '-1.5'] = process.argv.slice(2);
const SR = 48000;
const raw = execSync(`ffmpeg -v error -i "${wav}" -ac 1 -ar ${SR} -f s16le -`, { maxBuffer: 1 << 30 });
const s = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
const segs = JSON.parse(readFileSync(transcriptPath, 'utf8')).segments;
let sum = 0;
let n = 0;
let peak = 0;
for (const g of segs) {
  const i0 = Math.max(0, Math.round(g.start * SR));
  const i1 = Math.min(s.length, Math.round(g.end * SR));
  for (let i = i0; i < i1; i += 1) {
    const v = s[i] / 32768;
    sum += v * v;
    n += 1;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
}
const rms = 20 * Math.log10(Math.sqrt(sum / Math.max(1, n)) + 1e-12);
const peakDb = 20 * Math.log10(peak + 1e-9);
const gain = Math.min(Number(targetArg) - rms, Number(headroomArg) - peakDb);
console.error(`语音 RMS ${rms.toFixed(1)} dBFS · 峰值 ${peakDb.toFixed(1)} dBFS → 补益 ${gain.toFixed(1)} dB`);
console.log(gain.toFixed(1));
