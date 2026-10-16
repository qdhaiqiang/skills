// 运镜节奏审计：把各段合成的 #cam 关键帧还原成整片缩放曲线，量化"有多少时间在放大、多久能看到一次全貌"。
// 用法: [STAGE_W=2560 STAGE_H=1440 SRC_W=4480] node scripts/camera-audit.mjs <工程目录>
// 指标：k>1.5 占比 / k>1.15 占比 / 全貌(k≈1)占比 / 最长看不到全貌的秒数 / 每分钟姿态变化次数。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = (process.argv[2] ?? '.').replace(/\/$/, '');
const dir = join(root, 'build/html');
const easeIO = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 4);

const parts = readdirSync(dir)
  .filter((f) => /^part\d+\.html$/.test(f))
  .sort((a, b) => Number(a.slice(4, -5)) - Number(b.slice(4, -5)));

const curve = [];
let offset = 0;
let moves = 0;
for (const file of parts) {
  const html = readFileSync(join(dir, file), 'utf8');
  const dur = Number(/data-duration="([\d.]+)"/.exec(html)?.[1] ?? 0);
  const keys = [];
  for (const m of html.matchAll(/tl\.(set|to)\("#cam",\s*\{[^}]*?scale:\s*([\d.]+)([^}]*)\},\s*([\d.]+)\)/g)) {
    const rest = m[3] ?? '';
    keys.push({
      kind: m[1],
      at: Number(m[4]),
      k: Number(m[2]),
      dur: Number(/duration:\s*([\d.]+)/.exec(rest)?.[1] ?? 0.8),
      solo: !/x:\s*-?[\d.]/.test(rest),
    });
    if (m[1] === 'to' && !/yoyo: true/.test(rest)) moves += 1;
  }
  keys.sort((a, b) => a.at - b.at);
  const kAt = (t) => {
    let k = 1;
    for (const key of keys) {
      if (key.solo) continue;
      if (t < key.at) break;
      if (key.kind === 'set' || t > key.at + key.dur) {
        k = key.k;
        continue;
      }
      k += (key.k - k) * easeIO((t - key.at) / key.dur);
    }
    return k;
  };
  for (let t = 0; t < dur; t += 0.25) curve.push({ k: kAt(Math.min(t, dur - 0.01)), global: offset + t });
  offset += dur;
}

const n = curve.length;
const share = (f) => (curve.filter((c) => f(c.k)).length / n) * 100;
let longest = 0;
let run = 0;
for (const c of curve) {
  if (c.k > 1.02) {
    run += 0.25;
    longest = Math.max(longest, run);
  } else run = 0;
}
console.log(`整片 ${offset.toFixed(1)}s · 运镜 ${moves} 次（${(moves / (offset / 60)).toFixed(1)} 次/分钟）`);
console.log(`k≈1 全貌 ${share((k) => k <= 1.02).toFixed(1)}% · 1.02<k≤1.5 ${share((k) => k > 1.02 && k <= 1.5).toFixed(1)}% · k>1.5 ${share((k) => k > 1.5).toFixed(1)}%`);
console.log(`最深 k=${Math.max(...curve.map((c) => c.k)).toFixed(3)} · 连续看不到全貌最长 ${longest.toFixed(1)}s`);
