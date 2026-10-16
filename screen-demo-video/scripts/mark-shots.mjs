// 从成片里按"标注真实落在屏幕上的位置"裁图，供逐张核对标注是否压在真实控件上。
// 用法: node mark-shots.mjs <工程目录> <成片.mp4> <输出目录>
//   横屏: 默认 STAGE_W=2560 STAGE_H=1440
//   竖屏: STAGE_W=1080 STAGE_H=1920 BAND=x,y,w,h（录屏只是舞台里的一张卡片，裁图要按卡片坐标换算）
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [rootArg, film, outDir = '/tmp/markshots'] = process.argv.slice(2);
const root = (rootArg ?? '.').replace(/\/$/, '');
const dir = join(root, 'build/html');
const W = Number(process.env.STAGE_W ?? 2560);
const H = Number(process.env.STAGE_H ?? 1440);
const [BX, BY, BW, BH] = process.env.BAND ? process.env.BAND.split(',').map(Number) : [0, 0, W, H];
const PAD = Math.round((BW * 150) / 2560); // 裁图时框外留白，随视口宽等比
const easeIO = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 4);
mkdirSync(outDir, { recursive: true });

const parts = readdirSync(dir).filter((f) => /^part\d+\.html$/.test(f)).sort((a, b) => Number(a.slice(4, -5)) - Number(b.slice(4, -5)));
let offset = 0;
let n = 0;
for (const file of parts) {
  const html = readFileSync(join(dir, file), 'utf8');
  const dur = Number(/data-duration="([\d.]+)"/.exec(html)?.[1] ?? 0);
  const keys = [];
  for (const m of html.matchAll(/tl\.(set|to)\("#cam",\s*\{[^}]*?scale:\s*([\d.]+)([^}]*)\},\s*([\d.]+)\)/g)) {
    const rest = m[3] ?? '';
    keys.push({ kind: m[1], at: Number(m[4]), k: Number(m[2]), x: /x:\s*(-?[\d.]+)/.test(rest) ? Number(/x:\s*(-?[\d.]+)/.exec(rest)[1]) : null, y: /y:\s*(-?[\d.]+)/.test(rest) ? Number(/y:\s*(-?[\d.]+)/.exec(rest)[1]) : null, dur: Number(/duration:\s*([\d.]+)/.exec(rest)?.[1] ?? 0.8), solo: !/x:\s*-?[\d.]/.test(rest) });
  }
  keys.sort((a, b) => a.at - b.at);
  const camAt = (t) => {
    let state = { k: 1, x: 0, y: 0 };
    for (const key of keys) {
      if (key.solo) continue;
      if (key.at === 0 && key.kind === 'set') continue;
      const target = { k: key.k, x: key.x ?? state.x, y: key.y ?? state.y };
      if (t < key.at) break;
      if (key.kind === 'set' || t > key.at + key.dur) {
        state = target;
        continue;
      }
      const e = easeIO((t - key.at) / key.dur);
      state = { k: state.k + (target.k - state.k) * e, x: state.x + (target.x - state.x) * e, y: state.y + (target.y - state.y) * e };
    }
    return state;
  };
  for (const m of html.matchAll(/class="clip mark[^"]*"[^>]*data-start="([\d.]+)" data-duration="([\d.]+)"[^>]*style="left:(-?[\d.]+)px; top:(-?[\d.]+)px; width:([\d.]+)px; height:([\d.]+)px/g)) {
    const start = Number(m[1]);
    const dd = Number(m[2]);
    const box = { l: Number(m[3]), t: Number(m[4]), w: Number(m[5]), h: Number(m[6]) };
    const mid = start + dd / 2;
    const c = camAt(mid);
    const sx = (p) => BX + (p - BW / 2) * c.k + BW / 2 + c.x;
    const sy = (p) => BY + (p - BH / 2) * c.k + BH / 2 + c.y;
    const l = Math.max(BX, sx(box.l) - PAD);
    const tp = Math.max(BY, sy(box.t) - PAD);
    const w = Math.min(BX + BW - l, sx(box.l + box.w) + PAD - l);
    const h = Math.min(BY + BH - tp, sy(box.t + box.h) + PAD - tp);
    const filmAt = Number((offset + mid).toFixed(2));
    const out = `${outDir}/m${String(++n).padStart(2, '0')}-${file.replace('.html', '')}-t${filmAt}.png`;
    execSync(`ffmpeg -v error -ss ${filmAt} -i "${film}" -frames:v 1 -vf "crop=${Math.round(w)}:${Math.round(h)}:${Math.round(l)}:${Math.round(tp)}" -y "${out}"`, { stdio: 'inherit' });
    console.log(`${out.split('/').pop()}  屏幕框 ${Math.round(sx(box.l))},${Math.round(sy(box.t))} ${Math.round(box.w * c.k)}x${Math.round(box.h * c.k)} k=${c.k.toFixed(2)}`);
  }
  offset += dur;
}
console.log(`共出图 ${n} 张 → ${outDir}`);
