// 运镜取景审计：逐个运镜姿态算出"落幅时屏幕上真正可见的源矩形"，再从源录屏里裁出这块，
// 用 ImageMagick 的 -trim 语义量出**有内容的包围盒**，判断这次放大是不是把画面喂给了空白。
// 用法: node ink-audit.mjs <工程目录> [--fuzz 15] [--min-cover 0.5] [--max-off 0.15]
// 输出：每个姿态一行；flag 的行给出建议 region（内容盒 + 边距）与建议 maxK。
// 说明：k 只由 region 与画面宽高比决定（同一 16:9 视口下横屏/竖屏算出的 k 相同），所以本工具与舞台尺寸无关。
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [rootArg, ...rest] = process.argv.slice(2);
const root = resolve((rootArg ?? '.').replace(/\/$/, ''));
const arg = (name, dft) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : dft;
};
const FUZZ = arg('fuzz', 15);
const MIN_COVER = arg('min-cover', 0.5);
const MAX_OFF = arg('max-off', 0.15);
const SRC_W = Number(process.env.SRC_W ?? 4480);
const SRC_H = Number(process.env.SRC_H ?? 2520);
const { plan } = await import(new URL(`file://${root}/build/plan.mjs`).href);
const MAX_K = plan.maxZoom ?? 2.2;
const MOVE = plan.moveSeconds ?? 0.62;
const spanById = Object.fromEntries(plan.spans.map((s) => [s.id, s]));
const tmp = '/tmp/ink-audit';
mkdirSync(tmp, { recursive: true });

// 与 build.mjs 的 poseOf 等价：k = min(maxK, 区域夹紧)，可见源矩形 = 画面/k，中心钳位在屏内。
const viewOf = (pose) => {
  const [rx, ry, rw, rh] = pose.region;
  const pad = pose.pad ?? 26;
  const k = Math.max(1, Math.min(pose.maxK ?? MAX_K, Math.min(SRC_W / (rw + pad * 2), SRC_H / (rh + pad * 2))));
  const vw = SRC_W / k;
  const vh = SRC_H / k;
  const cx = Math.min(SRC_W - vw / 2, Math.max(vw / 2, rx + rw / 2));
  const cy = Math.min(SRC_H - vh / 2, Math.max(vh / 2, ry + rh / 2));
  return { k, x: Math.round(cx - vw / 2), y: Math.round(cy - vh / 2), w: Math.round(vw), h: Math.round(vh) };
};

const rows = [];
for (const shot of plan.shots) {
  for (const [i, pose] of (shot.camera ?? []).entries()) {
    if (!pose.region) continue;
    const v = viewOf(pose);
    if (v.k <= 1.15) {
      rows.push({ shot: shot.id, i: i + 1, at: pose.at, k: v.k, cover: 1, off: 0, v, ok: true });
      continue;
    }
    const t = Math.min(pose.at + MOVE + 0.4, shot.out - 0.2);
    const file = `${tmp}/${shot.id}-${i + 1}.png`;
    execSync(`ffmpeg -v error -ss ${t} -i "${root}/${spanById[shot.span].src}" -frames:v 1 -y "${file}"`, { stdio: 'ignore' });
    // 先量整屏的内容包围盒（四角主色以外都算有内容），再和可见矩形求交
    const full = execSync(`magick "${file}" -fuzz ${FUZZ}% -format "%@" info:`).toString().trim();
    const fm = /(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/.exec(full);
    if (!fm) {
      rows.push({ shot: shot.id, i: i + 1, at: pose.at, k: Number(v.k.toFixed(2)), cover: 0, cut: 1, v, ok: false, region: [0, 0, SRC_W, SRC_H] });
      continue;
    }
    const [, cbw, cbh, cbx, cby] = fm.map(Number);
    const B = { x: cbx, y: cby, w: cbw, h: cbh };
    const ix = Math.max(0, Math.min(B.x + B.w, v.x + v.w) - Math.max(B.x, v.x));
    const iy = Math.max(0, Math.min(B.y + B.h, v.y + v.h) - Math.max(B.y, v.y));
    const inter = ix * iy;
    const dead = Number((1 - inter / (v.w * v.h)).toFixed(2)); // 视口里有多少是空白（设计方："放大了一段无用的空白区域"）
    const cut = Number((1 - inter / (B.w * B.h)).toFixed(2)); // 内容有多少被切在画外（"有用的内容没有显示"）
    const cover = Number((inter / (v.w * v.h)).toFixed(2));
    const off = Number((Math.max(Math.abs(B.x + B.w / 2 - (v.x + v.w / 2)) / v.w, Math.abs(B.y + B.h / 2 - (v.y + v.h / 2)) / v.h)).toFixed(2));
    // 建议：以内容盒为准，按视口宽高比外扩到刚好铺满，再留 4% 边距
    const ar = SRC_W / SRC_H;
    let rw = Math.max(B.w, B.h * ar);
    let rh = rw / ar;
    if (rh > SRC_H) {
      rh = SRC_H;
      rw = rh * ar;
    }
    const cx = Math.min(SRC_W - rw / 2, Math.max(rw / 2, B.x + B.w / 2));
    const cy = Math.min(SRC_H - rh / 2, Math.max(rh / 2, B.y + B.h / 2));
    const region = [cx - rw / 2, cy - rh / 2, rw, rh].map((n) => Math.round(n / 10) * 10);
    const bbox = [B.x, B.y, B.w, B.h].map((n) => Math.round(n / 10) * 10);
    rows.push({ shot: shot.id, i: i + 1, at: pose.at, k: Number(v.k.toFixed(2)), cover, dead, cut, off, v, bbox, ok: dead <= 0.45 && (cut <= 0.25 || B.w * B.h > 1.6 * v.w * v.h), region });
  }
}

for (const r of rows) {
  const flag = r.ok ? '   ' : '!!';
  console.log(`${flag} ${r.shot}#${r.i} at=${String(r.at).padStart(6)} k=${r.k} 视口空白=${r.dead ?? 0} 内容被切=${r.cut ?? 0} 内容盒=[${r.bbox ?? '全屏'}] 可见=[${r.v.x},${r.v.y},${r.v.w},${r.v.h}]${r.ok ? '' : ` 建议 region=[${r.region}] maxK=${Math.min(MAX_K, Number(Math.max(1, Math.min(SRC_W / (r.region[2] + 52), SRC_H / (r.region[3] + 52))).toFixed(2)))}`}`);
}
console.log(`共 ${rows.length} 个姿态 · 需复核 ${rows.filter((r) => !r.ok).length} 个（视口空白>0.45，或内容盒比视口小却被切>0.25）`);
