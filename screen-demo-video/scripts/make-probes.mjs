// 由分镜计划自动生成分段抽查时刻 build/probes.json。
// 用法: node make-probes.mjs <工程目录>
// 每个镜头取：镜头开头 1s（看全貌/构图）、每次运镜落幅后 1.6s（看是否压在讲的东西上）、
// 每个标注出现 1s 后（看框是否落在真实控件上），1.2s 内去重，最多 4 帧。
const path = await import('node:path');
const rootDir = path.resolve(process.argv[2] ?? '.');
const { plan } = await import(new URL(`file://${rootDir}/build/plan.mjs`).href);
const fs = await import('node:fs');
const probes = {};
for (const shot of plan.shots) {
  const ts = [shot.in + 1.0, ...(shot.camera ?? []).map((p) => p.at + 1.6), ...(shot.marks ?? []).map((m) => m.at + 1.0)]
    .filter((t) => t >= shot.in && t < shot.out - 0.3)
    .sort((a, b) => a - b);
  const keep = [];
  for (const t of ts) if (!keep.some((o) => Math.abs(o - t) < 1.2)) keep.push(Number(t.toFixed(1)));
  probes[shot.id] = keep.slice(0, 4);
}
const file = `${rootDir}/build/probes.json`;
fs.writeFileSync(file, JSON.stringify(probes, null, 1));
console.log(`${file}: ${Object.values(probes).flat().length} 帧 / ${Object.keys(probes).length} 个镜头`);
