// 客观核对：对每个 part 合成，解析 #cam 的 GSAP 关键帧与标注框几何，
// 算出标注持续期内的相机变换，判断标注矩形是否完整落在画面内（避免"框跑到画外"）。
// 用法: node mark-fit.mjs <工程目录>
//   横屏（录屏铺满舞台）: 默认 STAGE_W=2560 STAGE_H=1440
//   竖屏（录屏只是舞台里的一张卡片）: BAND=x,y,w,h  STAGE_W=1080 STAGE_H=1920
// 关键：GSAP 默认 transform-origin 是元素中心，屏幕坐标 = (p - 半宽) * k + 半宽 + x，
// 而不是 p * k + x；合成里写的 left/top 已经是舞台/视口像素，不要再乘一次 S。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? '.';
const dir = join(root, 'build/html');
const stageW = Number(process.env.STAGE_W ?? 2560);
const stageH = Number(process.env.STAGE_H ?? 1440);
const band = process.env.BAND ? process.env.BAND.split(',').map(Number) : null;
// 视口矩形：竖屏录制卡片；横屏时录屏铺满整个舞台。
const [BX, BY, BW, BH] = band ?? [0, 0, stageW, stageH];
// 容差按视口宽等比：960 宽视口下取 12px —— 标注描边本身画在框外（竖版 6px），框体还有 1.2%
// 呼吸缩放，贴在屏幕左边缘的终端框本就无法再往右挪；超过这个比例才算真出画。
const TOL = Math.max(6, Math.round((BW * 12) / 960));
const easeIO = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 4);

let bad = 0;
let seen = 0;
for (const file of readdirSync(dir).filter((f) => /^part\d+\.html$/.test(f)).sort((a, b) => Number(a.slice(4, -5)) - Number(b.slice(4, -5)))) {
  const html = readFileSync(join(dir, file), 'utf8');
  // 相机关键帧：tl.to("#cam", { scale: k, x, y, duration: d, ease: ... }, at)
  const keys = [{ at: 0, k: 1, x: 0, y: 0 }];
  for (const m of html.matchAll(/tl\.(set|to)\("#cam",\s*\{[^}]*?scale:\s*([\d.]+)([^}]*)\},\s*([\d.]+)\)/g)) {
    const rest = m[3] ?? '';
    keys.push({
      kind: m[1],
      at: Number(m[4]),
      k: Number(m[2]),
      x: /x:\s*(-?[\d.]+)/.test(rest) ? Number(/x:\s*(-?[\d.]+)/.exec(rest)[1]) : null,
      y: /y:\s*(-?[\d.]+)/.test(rest) ? Number(/y:\s*(-?[\d.]+)/.exec(rest)[1]) : null,
      dur: Number(/duration:\s*([\d.]+)/.exec(rest)?.[1] ?? 0.8),
    });
  }
  keys.sort((a, b) => a.at - b.at);
  // GSAP: to() 从 at 起补间 dur 秒到目标；set() 立即生效；未给出的属性保持当前值。
  const camAt = (t) => {
    let state = { k: 1, x: 0, y: 0 };
    for (const key of keys) {
      if (key.at === 0 && key.kind === 'set') continue;
      const target = { k: key.k, x: key.x ?? state.x, y: key.y ?? state.y };
      if (t < key.at) break;
      if (key.kind === 'set' || t > key.at + key.dur) {
        state = target;
        continue;
      }
      if (key.kind === 'set') break;
      const e = easeIO((t - key.at) / key.dur);
      state = { k: state.k + (target.k - state.k) * e, x: state.x + (target.x - state.x) * e, y: state.y + (target.y - state.y) * e };
    }
    return state;
  };
  for (const m of html.matchAll(/class="clip mark[^"]*"[^>]*data-start="([\d.]+)" data-duration="([\d.]+)"[^>]*style="left:(-?[\d.]+)px; top:(-?[\d.]+)px; width:([\d.]+)px; height:([\d.]+)px/g)) {
    const start = Number(m[1]);
    const dur = Number(m[2]);
    const box = { l: Number(m[3]), t: Number(m[4]), w: Number(m[5]), h: Number(m[6]) };
    seen += 1;
    let worst = null;
    for (let t = start; t <= start + dur + 1e-6; t += 0.2) {
      const c = camAt(t);
      const x = (l) => BX + (l - BW / 2) * c.k + BW / 2 + c.x;
      const left = x(box.l);
      const right = x(box.l + box.w);
      const y = (p) => BY + (p - BH / 2) * c.k + BH / 2 + c.y;
      const yTop = y(box.t);
      const yBot = y(box.t + box.h);
      const over = Math.max(-left + BX, right - (BX + BW), -yTop + BY, yBot - (BY + BH));
      if (over > TOL && (!worst || over > worst.over)) worst = { t: Number(t.toFixed(2)), over: Number(over.toFixed(0)), c };
    }
    if (worst) {
      bad += 1;
      console.log(`!! ${file} 标注 ${box.l},${box.t},${box.w},${box.h} 在 ${worst.t}s 出画 ${worst.over}px（k=${worst.c.k.toFixed(3)}）`);
    }
  }
}
console.log(`共检查标注 ${seen} 个 · 出画 ${bad} 个 · 判定框 [${BX},${BY},${BW}x${BH}] · 容差 ${TOL}px`);
