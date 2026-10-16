// 由手机版/原始分镜派生 PC 观看版 plan：每镜先给全貌，至多一次下探，看完回全貌；标注每镜至多一个。
// 用法: node mk-pc-plan.mjs <原始plan.mjs绝对路径> > <pc工程>/build/plan.mjs
// 生成一次后它就是交付件，微调直接改生成出来的文件，别指望重跑。
import { pathToFileURL } from 'node:url';
import { argv } from 'node:process';

const src = argv[2];
if (!src) { console.error('用法: node mk-pc-plan.mjs <原始plan.mjs>'); process.exit(1); }
const { plan } = await import(pathToFileURL(src).href);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const r1 = (n) => Math.round(n * 10) / 10;
const SRC_W = plan.sourceWidth ?? 4480;
const SRC_H = plan.sourceHeight ?? 2520;

const shots = plan.shots.map((shot) => {
  const poses = shot.camera ?? [];
  const boxes = poses.map((c) => c.region);
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[3] + b[1]));
  let w = x1 - x0;
  let h = y1 - y0;
  const ar = SRC_W / SRC_H;
  if (w / h < ar) w = h * ar; else h = w / ar;
  // 建立镜头给"整屏"（k=1.0）：这是 PC 版留给观众的布局参照；下探看完必须回到整屏再收尾。
  const overview = [0, 0, SRC_W, SRC_H];
  const first0 = (shot.marks ?? [])[0];
  const inside = (b, r) => b[0] >= r[0] && b[1] >= r[1] && b[0] + b[2] <= r[0] + r[2] && b[1] + b[3] <= r[1] + r[3];
  const camera = [{ at: r1(shot.in + 0.4), region: overview, maxK: 1.12 }];
  const smaller = poses.filter((c) => (c.region[2] < SRC_W * 0.6 || c.region[3] < SRC_H * 0.6) && c.at > shot.in + 3);
  const withMark = smaller.find((c) => first0 && inside(first0.region, c.region));
  const detail = withMark ?? smaller.find((c) => c.at > shot.in + 3);
  const span = shot.out - shot.in;
  const backAt = r1(shot.out - 5.5);
  const detailAt = r1(clamp(Math.min(detail?.at ?? 0, shot.out - 16), shot.in + 3.2, backAt - 4));
  if (detail && span > 12 && backAt - 4 >= shot.in + 3.2) {
    camera.push({ at: detailAt, region: detail.region.map((n) => Math.round(n)), maxK: 1.5 });
    camera.push({ at: backAt, region: overview, maxK: 1.12 });
  }
  // 标注的整个存续期（含 lead/hold）都不能被后续运镜甩出取景，容不下就不给标注（PC 版本就从简）。
  const atPose = (t) => camera.filter((c) => c.at <= t + 0.001).pop() ?? camera[0];
  void atPose;
  const keepAt = first0 ? r1(Math.min(first0.at, shot.out - 1.2)) : 0;
  const keep = first0 && camera
    .filter((c) => c.at <= keepAt + (first0.lead ?? 0) + (first0.hold ?? 2))
    .every((c) => inside(first0.region, c.region))
    ? [{ ...first0, at: keepAt }] : [];
  return { ...shot, camera, marks: keep };
});

const out = { ...plan, maxZoom: 1.6, breath: 0.006, moveSeconds: 0.7, shots };
process.stdout.write(`// PC 观看版分镜：由 ${src} 按 pc 预设收密度派生——\n`
  + `// 每镜先给全貌、至多一次 ≤1.55 的下探、标注每镜至多一个；时间轴/字幕/音频与手机版完全同源。\n`
  + `// 需要微调时直接改本文件（它是交付件，不再是生成物）。\nexport const plan = ${JSON.stringify(out, null, 2)};\n`);
