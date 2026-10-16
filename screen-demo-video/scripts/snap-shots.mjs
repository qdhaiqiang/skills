// 渲染前抽查：把每个镜头的代表时刻换算成本段局部时间，逐段 snapshot 出图，再拼成带时刻标注的接触表。
// 用法: node snap-shots.mjs <合成工程目录> [起始段号] [结束段号]
// 前置: 工程里要有 build/probes.json（{ "S3": [25, 29, 34], ... }，秒数为源视频时间）
//      以及由 build.mjs --print-clips=1 生成的段表（本脚本会自己取）。
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = (process.argv[2] ?? '.').replace(/\/$/, '');
const from = Number(process.argv[3] ?? 1);
const to = Number(process.argv[4] ?? 99);
const outDir = process.env.OUT ?? '/tmp/snap-review';

const clips = spawnSync('node', [join(root, 'build/build.mjs'), '--print-clips=1'], { encoding: 'utf8' }).stdout.trim().split('\n');
const { plan } = await import(new URL(`file://${process.cwd()}/${root}/build/plan.mjs`).href);
const probes = JSON.parse(readFileSync(join(root, 'build/probes.json'), 'utf8'));
const backup = '/tmp/snap-index-backup.html';
if (existsSync(join(root, 'index.html')) && !existsSync(backup)) copyFileSync(join(root, 'index.html'), backup);
mkdirSync(outDir, { recursive: true });

for (let i = from; i <= Math.min(to, clips.length); i += 1) {
  const [sid, a, b] = clips[i - 1].split(',').map((v, k) => (k ? Number(v) : v));
  const shot = plan.shots.find((s) => s.span === sid && Number(s.in) === Number(a));
  if (!shot) {
    console.log(`第 ${i} 段找不到镜头 ${sid}[${a},${b}]`);
    continue;
  }
  const times = (probes[shot.id] ?? [])
    .filter((t) => t >= shot.in && t < shot.out)
    .map((t) => Number((t - shot.in + (i === 1 ? plan.titleSeconds : 0)).toFixed(2)));
  if (!times.length) continue;
  copyFileSync(join(root, 'build/html', `part${i}.html`), join(root, 'index.html'));
  const dir = `${outDir}/p${i}`;
  const r = spawnSync('npx', ['hyperframes', 'snapshot', '.', '--at', times.join(','), '--no-end', '--describe', 'false', '-o', dir], { cwd: root, encoding: 'utf8' });
  writeFileSync(`${dir}.label`, `${shot.id} ${shot.label}`);
  console.log(`${i}\t${shot.id} ${shot.label}\t${r.status === 0 ? 'ok' : 'FAIL'}\t${times.join(' ')}`);
}
if (existsSync(backup)) copyFileSync(backup, join(root, 'index.html'));
console.log(`出图目录 ${outDir}；用 montage -tile 3x3 -geometry 850x478 拼接触表后逐张看。`);
