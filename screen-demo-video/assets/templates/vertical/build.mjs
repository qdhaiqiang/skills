// 由 plan.mjs + 各段转写 JSON 生成 index.html（第六集 · 手机竖屏版：1080×1920）
// 用法: node build/build.mjs [--clip=段id,源起,源止] [--out=partN.html] [--audio=...] [--bgm=...] [--print-clips=N]
// 版式规则见 skill screen-demo-video/references/targets.md 的「竖屏 9:16 版式」：
// 录屏只是竖屏卡片中的一个 16:9 视口，字幕/章节/关键词都排在视口之外的深色版面上，
// 视口以下的内容右边缘必须收在 x<=940，给全面屏 app 的右侧操作栏留位置。
// 每段录屏按 in/out + data-media-start 直接引用，1.0x 原速，不剪切、不变速。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan } from './plan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, '..');

// 画质倍率 Q：1080×1920 舞台里录制视口只有 960×540，源录屏 4480 宽被压到 0.21 倍，
// 电脑上 1:1 打开看不清字。视口宽度受舞台宽度钳制，唯一的解决办法是整体放大舞台：
// Q=2 即 2160×3840 舞台、1920×1080 视口，录屏显示比例追平手机版（0.43 vs 0.57）。
// 所有版式尺寸都走 px()/VW/mk()，缩放只需改这一处。
const Q = Number((process.argv.find((a) => a.startsWith('--q=')) ?? '').slice(4) || process.env.QUALITY || 2);
const W = Math.round(1080 * Q);
const H = Math.round(1920 * Q);
const SRC_W = 4480;
// 录制视口：16:9 卡片，左右各留 60；上方品牌带+章节角标，下方紧贴字幕带/关键词带。
// 纵向分区（1920 高）：0-200 状态栏留白 / 230-300 品牌 / 340 章节角标 / 440-980 录屏 /
// 1008 起字幕带（与关键词带同区，二者按时间互斥）/ 1400 以下留给 app 的标题与进度条。
const VW = Math.round(960 * Q);
const VH = Math.round(540 * Q);
const VX = Math.round(60 * Q);
const VY = Math.round(440 * Q);
const COL = Math.round(820 * Q); // 字幕/关键词区宽度：整屏居中，右边缘避开右侧操作栏
const SUB_TOP = VY + VH + Math.round(28 * Q);
const CO_TOP = SUB_TOP;
// 顶部品牌带/章节角标：设计方要求整体往右、往下挪（原来贴着屏幕左上角，太顶太靠左）。
// 左边界从视口左边再缩进 60Q，字号带保持右边缘 ≤ 950Q 的安全区。
const HEAD_X = VX + Math.round(60 * Q);
const BRAND_TOP = Math.round(262 * Q);
const CHIP_TOP = Math.round(366 * Q);
const CX = Math.round((W - COL) / 2); // 字幕带整屏居中（设计方："字幕不居中"）
const S = VW / SRC_W; // 源录屏像素 -> 视口像素：运镜与标注坐标都按它算
const px = (n) => Math.round(n * Q); // 版式尺寸按 1080×1920 基准给出，再乘画质倍率
const mk = (n) => Math.max(2, Math.round((n * VW) / 1920)); // 压在画面上的标注按视口宽等比缩放
const MAX_K = plan.maxZoom ?? 2.2;
const MOVE = plan.moveSeconds ?? 0.62;
const BREATHE = plan.breath ?? 0.012;
const round = (n, p = 2) => Number(n.toFixed(p));
const titleSeconds = plan.titleSeconds;

const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

/* ---------- 0. 两段的时间轴基准 ---------- */
const spans = plan.spans.map((span) => ({ ...span, duration: round(span.out - span.in) }));
let acc = 0;
for (const span of spans) {
  span.offset = round(acc);
  acc += span.duration;
}
const spanById = Object.fromEntries(spans.map((s) => [s.id, s]));
const contentTotal = round(acc);
const fullTotal = round(titleSeconds + contentTotal + plan.tailSeconds);

/* ---------- 0b. 原声转写 -> 拍（真实句子时间码） ---------- */
const WIDTH_RE = /[　-〿一-＀-￯]/;
const widthOf = (text) => [...text].reduce((s, ch) => s + (WIDTH_RE.test(ch) ? 1 : ch === ' ' ? 0.34 : 0.56), 0);
const tidy = (text) => text.replace(/,/g, '，').replace(/:/g, '：').replace(/!/g, '！').replace(/\?/g, '？');
// 拆分字幕取自原始词流，绕过了整句 textFix，这里按子串再纠一次行业词误听。
const polish = (text) => Object.entries(plan.textPolish ?? {}).reduce((s, [from, to]) => s.split(from).join(to), text);

const cueText = (seg, from, to) =>
  polish(
    tidy(
      seg.words
        .filter((w) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 <= to)
        .map((w) => w.word)
        .join('')
        .trim(),
    ),
  );

const beats = [];
// 同一条录屏被切成多个窗口时，句子校正值按"转写段序号"复用，不必为每个窗口重复一遍。
const sameBase = (span) => span.transcript === plan.baseTranscript;
for (const span of spans) {
  const transcript = JSON.parse(readFileSync(join(project, span.transcript), 'utf8'));
  transcript.segments.forEach((seg, index) => {
    const id = `${span.id}${String(index + 1).padStart(2, '0')}`;
    const fixed = plan.textFix?.[id] ?? (sameBase(span) ? plan.textFixByIdx?.[index + 1] : null);
    const text = polish(tidy(fixed ?? seg.text));
    beats.push({ id, idx: index + 1, span: span.id, text, start: seg.start, end: seg.end });
  });
}

/* ---------- 1. 分段（一段渲染 = 一段录屏的一个源窗口） ---------- */
const clipArg = argOf('clip');
let clipSpan;
let partIn;
let partOut;
if (clipArg) {
  const [id, a, b] = clipArg.split(',');
  clipSpan = spanById[id];
  partIn = round(Number(a));
  partOut = round(Number(b));
} else {
  clipSpan = spans[0];
  partIn = clipSpan.in;
  partOut = round(clipSpan.in + contentTotal);
}
if (argOf('print-clips')) {
  // 只在镜头边界处切段：边界都落在原声停顿里，不会把一句话剪断。
  const pieces = [];
  for (const span of spans) {
    const outs = plan.shots.filter((s) => s.span === span.id).map((s) => s.out).filter((v) => v > span.in + 1e-6 && v < span.out - 1e-6);
    const cuts = [span.in, ...outs.sort((x, y) => x - y), span.out];
    for (let i = 0; i < cuts.length - 1; i += 1) pieces.push(`${span.id},${round(cuts[i])},${round(cuts[i + 1])}`);
  }
  console.log(pieces.join('\n'));
  process.exit(0);
}
const withTitle = clipArg ? clipSpan.id === spans[0].id && Math.abs(partIn - spans[0].in) < 1e-6 : true;
const isLastPart = clipArg ? clipSpan.id === spans[spans.length - 1].id && Math.abs(partOut - spans[spans.length - 1].out) < 1e-6 : true;
const contentStart = withTitle ? titleSeconds : 0;
const local = (srcAt) => round(contentStart + (srcAt - partIn));
const total = round(contentStart + (partOut - partIn) + (isLastPart ? plan.tailSeconds : 0));

const inPart = beats.filter((b) => b.span === clipSpan.id && b.end > partIn + 1e-6 && b.start < partOut - 1e-6);
const shots = plan.shots.filter((s) => s.span === clipSpan.id && s.out > partIn + 1e-6 && s.in < partOut - 1e-6);

const problems = [];
if (!clipArg) {
  const covered = new Set();
  for (const shot of plan.shots) for (const beat of beats) if (beat.span === shot.span && beat.end > shot.in + 1e-6 && beat.start < shot.out - 1e-6) covered.add(beat.id);
  // 同一段录屏可能被拆成两个窗口（跳过空等），窗口外的句子不属于本片，不参与覆盖检查。
  for (const beat of beats) {
    const span = spanById[beat.span];
    if (beat.end <= span.in + 1e-6 || beat.start >= span.out - 1e-6) continue;
    if (!covered.has(beat.id)) problems.push(`原声拍 ${beat.id} 落在所有镜头之外，会静默丢失：${beat.text}`);
  }
}
for (const shot of shots) {
  for (const pose of shot.camera ?? []) if (pose.at < shot.in - 1e-6 || pose.at > shot.out) problems.push(`${shot.id} 运镜 at=${pose.at} 超出镜头窗口 ${shot.in}~${shot.out}`);
  for (const [i, mark] of (shot.marks ?? []).entries()) {
    const hold = mark.hold ?? (mark.type === 'typing' ? 2.4 : 1.2);
    if (mark.at + hold > shot.out + 1e-6) problems.push(`${shot.id} 标注 #${i + 1} 超出镜头尾 ${round(mark.at + hold - shot.out)}s`);
  }
}
if (problems.length) {
  console.error('分镜校验失败：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

/* ---------- 2. 运镜姿态（在录制视口坐标系里，与横屏版同一套 region 得到同一个 k） ---------- */
const poseOf = (pose) => {
  const region = pose?.region;
  if (!region) return { k: 1, x: 0, y: 0 };
  const [rx, ry, rw, rh] = region;
  const pad = pose.pad ?? 26;
  const sw = (rw + pad * 2) * S;
  const sh = (rh + pad * 2) * S;
  const k = Math.max(1, Math.min(pose.maxK ?? MAX_K, Math.min(VW / sw, VH / sh)));
  const halfW = VW / (2 * k);
  const halfH = VH / (2 * k);
  const cx = Math.min(VW - halfW, Math.max(halfW, (rx + rw / 2) * S));
  const cy = Math.min(VH - halfH, Math.max(halfH, (ry + rh / 2) * S));
  return { k: round(k, 3), x: round((VW / 2 - cx) * k), y: round((VH / 2 - cy) * k) };
};

const cameraMoves = [`  tl.set("#cam", { scale: 1, x: 0, y: 0 }, ${contentStart});`];
{
  const poses = [];
  for (const shot of shots) for (const pose of shot.camera ?? []) if (pose.at >= partIn - 1e-6 && pose.at <= partOut) poses.push(pose);
  poses.sort((a, b) => a.at - b.at);
  let prev = poseOf(null);
  let lastAt = contentStart;
  for (const pose of poses) {
    const at = local(pose.at);
    const dur = pose.dur ?? MOVE;
    const next = poseOf(pose);
    if (next.k === prev.k && next.x === prev.x && next.y === prev.y) {
      lastAt = Math.max(lastAt, round(at + dur));
      continue;
    }
    cameraMoves.push(`  tl.to("#cam", { scale: ${next.k}, x: ${next.x}, y: ${next.y}, duration: ${dur}, ease: "power2.inOut" }, ${at});`);
    prev = next;
    lastAt = round(at + dur);
  }
  const hold = round(total - lastAt - 0.25);
  if (hold > 1.8 && prev.k > 1.02) {
    const half = round(hold / 2);
    cameraMoves.push(`  tl.to("#cam", { scale: ${round(prev.k * (1 + BREATHE), 4)}, duration: ${half}, ease: "sine.inOut", yoyo: true, repeat: 1 }, ${round(lastAt + 0.25)});`);
  }
}

/* ---------- 3. 交互标注（坐标 = 源像素 × S，相对录制视口） ---------- */
const marks = [];
for (const shot of shots) {
  (shot.marks ?? []).forEach((mark, i) => {
    if (mark.at < partIn || mark.at > partOut) return;
    const [mx, my, mw, mh] = mark.region;
    const type = mark.type ?? 'click';
    const lead = mark.lead ?? (type === 'typing' ? 0.4 : 0.5);
    const hold = mark.hold ?? (type === 'typing' ? 2.4 : 1.2);
    marks.push({
      id: `mk-${shot.id}-${i}`,
      type,
      start: local(mark.at - lead),
      duration: round(lead + hold),
      at: local(mark.at),
      box: { left: round(mx * S), top: round(my * S), width: round(mw * S), height: round(mh * S) },
    });
  });
}

/* ---------- 4. 字幕（原声句子的真实时间码） ---------- */
const CJK_BREAK = /[，。；：、！？）]/;
// 固定字号下只能靠换行容纳：按"每行可容纳的字宽"贪心断行，能贴着标点断就贴着标点断，绝不缩字号。
const wrapCJK = (text, unitsPerLine) => {
  const lines = [];
  let current = '';
  let acc = 0;
  for (const ch of text) {
    const w = widthOf(ch);
    // 避头点：句读不能领起一行——放不下就让它留在本行末尾，宁可这一行略宽一点。
    if (acc + w > unitsPerLine && current && CJK_BREAK.test(ch)) {
      lines.push(current + ch);
      current = '';
      acc = 0;
      continue;
    }
    if (acc + w > unitsPerLine && current) {
      const cut = [...current].reduce((best, c, i) => (CJK_BREAK.test(c) ? i + 1 : best), 0);
      if (cut > 0) {
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
        acc = widthOf(current);
      } else {
        lines.push(current);
        current = '';
        acc = 0;
      }
    }
    current += ch;
    acc += w;
  }
  if (current) lines.push(current);
  return lines;
};
const subLines = [];
for (const beat of inPart) {
  const seg = JSON.parse(readFileSync(join(project, spanById[beat.span].transcript), 'utf8')).segments[beat.idx - 1];
  const split = plan.cueSplit?.[beat.id] ?? (sameBase(spanById[beat.span]) ? plan.cueSplitByIdx?.[beat.idx] : null);
  const cues = split ? split.map((c) => ({ start: c[0] - seg.start, end: c[1] - seg.start, text: cueText(seg, c[0], c[1]) })) : [{ start: 0, end: seg.end - seg.start, text: beat.text }];
  for (const cue of cues) {
    const text = cue.text.trim();
    if (!text) continue;
    const start = round(Math.max(beat.start, beat.start + cue.start) - 0.06);
    const end = round(Math.min(beat.end, beat.start + cue.end) + 0.4);
    if (end <= partIn || start >= partOut) continue;
    subLines.push({ text, start: local(Math.max(start, partIn)), duration: round(Math.min(end, partOut) - Math.max(start, partIn)) });
  }
}
for (const [i, sub] of subLines.entries()) {
  const next = subLines[i + 1];
  if (next && sub.start + sub.duration > next.start) sub.duration = round(next.start - sub.start);
}
// 竖版字幕一律固定字号（设计方："有的字号大有的字号小，要保持统一；文字长了可以换行，但不能缩小字号"）。
// 一行放不下就按 CJK 断行折到最多 3 行，字号始终用 subtitleFixed，绝不为塞进一行而降字号。
const SUB_SIZE = px(plan.subtitleFixed ?? plan.subtitleMax ?? 48);
const SUB_UNITS_PER_LINE = (px(plan.subtitleWidth ?? 880) - px(28)) / SUB_SIZE;
for (const sub of subLines) {
  sub.size = SUB_SIZE;
  sub.lines = widthOf(sub.text) <= SUB_UNITS_PER_LINE ? [sub.text] : wrapCJK(sub.text, SUB_UNITS_PER_LINE);
}

/* ---------- 5. 章节角标 ---------- */
const chapterOf = {};
for (const group of plan.chapters ?? []) {
  const i0 = plan.shots.findIndex((s) => s.id === group.from);
  const i1 = plan.shots.findIndex((s) => s.id === (group.to ?? group.from));
  if (i0 < 0 || i1 < 0) continue;
  for (let i = i0; i <= i1; i += 1) chapterOf[plan.shots[i].id] ??= group.label;
}
const chips = [];
for (const shot of shots) {
  const label = chapterOf[shot.id];
  if (!label) continue;
  const start = local(Math.max(shot.in, partIn));
  const end = local(Math.min(shot.out, partOut));
  const prev = chips[chips.length - 1];
  if (prev && prev.text === label) prev.end = end;
  else chips.push({ text: label, start, end });
}
for (const chip of chips) {
  chip.start = round(chip.start + 0.2);
  chip.duration = round(chip.end - chip.start - 0.2);
}

/* ---------- 5b. 关键词标签层 ---------- */
const callouts = [];
for (const spec of plan.callouts ?? []) {
  if (spec.span !== clipSpan.id || spec.out <= partIn || spec.at >= partOut) continue;
  const start = round(Math.max(spec.at, partIn));
  const end = round(Math.min(spec.out, partOut));
  callouts.push({
    caption: spec.caption,
    start: local(start),
    duration: round(end - start),
    items: (spec.items ?? [])
      .filter((item) => item.at >= start - 1e-6 && item.at <= end)
      .map((item) => ({ text: item.text, arrow: Boolean(item.arrow), tone: item.tone ?? 'info', at: local(item.at) })),
  });
}

/* ---------- 6. 音频：原始录音 + 轻 BGM（人声段下压） ---------- */
const audioSrc = argOf('audio') ?? clipSpan.audio;
const hasAudio = existsSync(join(project, audioSrc));
const voiceWindows = inPart.map((b) => ({ start: Math.max(b.start, partIn), end: Math.min(b.end, partOut) }));
const bgmPoints = [];
{
  const { bed = 0.11, duck = 0.04 } = plan.bgmLevels ?? {};
  let t = 0;
  if (withTitle) {
    bgmPoints.push({ t: 0, v: 0 }, { t: round(titleSeconds * 0.55), v: bed });
    t = round(titleSeconds * 0.55);
  } else {
    bgmPoints.push({ t: 0, v: bed });
  }
  for (const [i, win] of voiceWindows.entries()) {
    const start = local(win.start);
    const end = local(win.end);
    const nextStart = voiceWindows[i + 1] ? local(voiceWindows[i + 1].start) : Infinity;
    if (start - t > 0.5) bgmPoints.push({ t: round(start - 0.35), v: bed });
    bgmPoints.push({ t: round(start), v: duck });
    bgmPoints.push({ t: round(Math.min(end + 0.2, Math.max(start + 0.2, nextStart - 0.05))), v: bed });
    t = end;
  }
  if (isLastPart) bgmPoints.push({ t: round(total - 2.2), v: bed }, { t: total, v: 0 });
  else bgmPoints.push({ t: total, v: bed });
}
const bgmSrc = argOf('bgm') ?? plan.bgm;
const hasBgm = existsSync(join(project, bgmSrc));

/* ---------- 7. HTML ---------- */
const markHtml = marks
  .map((m) => {
    const frame = m.type === 'box';
    const ring = frame ? '' : '\n        <div class="mark-ring"></div>';
    return `      <div class="clip mark ${frame ? 'mark-frame' : `mark-${m.type}`}" id="${m.id}" data-start="${m.start}" data-duration="${m.duration}" data-track-index="3" data-layout-allow-overflow data-layout-allow-overlap style="left:${m.box.left}px; top:${m.box.top}px; width:${m.box.width}px; height:${m.box.height}px">
        <div class="mark-box"></div>${ring}
      </div>`;
  })
  .join('\n');

const videoHtml = `      <video id="v-main" class="clip" src="${clipSpan.src}" data-start="${contentStart}" data-duration="${round(partOut - partIn)}" data-media-start="${partIn}" data-track-index="0" muted playsinline></video>`;

const chipHtml = chips
  .map(
    (chip, i) => `    <div class="clip chip" id="chip-${i}" data-start="${chip.start}" data-duration="${chip.duration}" data-track-index="5" data-layout-allow-occlusion>
      <div class="chip-inner"><span class="chip-dot"></span><span class="chip-text">${chip.text}</span></div>
    </div>`,
  )
  .join('\n');

const calloutHtml = callouts
  .map(
    (co, i) => `    <div class="clip callout" id="co-${i}" data-start="${co.start}" data-duration="${co.duration}" data-track-index="7" data-layout-allow-overflow data-layout-allow-overlap>
      <div class="co-body">
        <div class="co-caption">${co.caption}</div>
        <div class="co-row">${co.items
          .map(
            (item, j) =>
              `${item.arrow ? '<span class="co-arrow" id="co-item-' + i + '-' + j + '-a">→</span>' : ''}<span class="co-pill co-${item.tone}" id="co-item-${i}-${j}">${item.text}</span>`,
          )
          .join('')}</div>
        <div class="co-caret"></div>
      </div>
    </div>`,
  )
  .join('\n');

const subHtml = subLines
  .map(
    (sub, i) => `    <div class="clip sub" id="sub-${i}" data-start="${sub.start}" data-duration="${sub.duration}" data-track-index="6">
      <div class="sub-inner" style="font-size:${sub.size}px">${sub.lines.map((line) => `<span class="sub-line">${line}</span>`).join('')}</div>
    </div>`,
  )
  .join('\n');

const brandHtml = `    <div class="clip brand" id="brand" data-start="0" data-duration="${total}" data-track-index="4">
      <div class="brand-kicker">${plan.titleKicker}</div>
      <div class="brand-title">${plan.shortTitle ?? plan.titleSub}</div>
    </div>`;

const titleHtml = `    <section id="title-card" class="clip" data-start="0" data-duration="${round(titleSeconds + 0.55)}" data-track-index="8">
      <div class="title-bg" data-layout-allow-overflow><div class="title-grid"></div><div class="title-glow"></div></div>
      <div class="title-body">
        <div class="title-kicker" id="t-kicker">${plan.titleKicker}</div>
        <h1 class="title-main" id="t-main">${plan.titleMain}</h1>
        <div class="title-sub" id="t-sub">${plan.titleSub}</div>
        <div class="title-line" id="t-line"></div>
        <div class="title-note" id="t-note">${plan.titleNote}</div>
      </div>
    </section>`;

const markTweens = marks
  .map((m) => {
    const lines = [
      `  tl.fromTo("#${m.id} .mark-box", { opacity: 0, scale: 1.1 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" }, ${m.start});`,
      `  tl.to("#${m.id} .mark-box", { opacity: 0, duration: 0.36, ease: "power1.in" }, ${round(m.start + m.duration - 0.4)});`,
    ];
    if (m.type === 'box') {
      lines.push(`  tl.fromTo("#${m.id}", { scale: 0.99 }, { scale: 1.012, duration: ${round(m.duration / 2)}, ease: "sine.inOut", yoyo: true, repeat: 1 }, ${m.start});`);
    } else {
      lines.push(`  tl.fromTo("#${m.id} .mark-ring", { opacity: 0.92, scale: 0.66 }, { opacity: 0, scale: ${m.type === 'typing' ? 1.14 : 1.55}, duration: ${m.type === 'typing' ? 1.2 : 0.75}, ease: "power2.out" }, ${m.at});`);
    }
    return lines.join('\n');
  })
  .join('\n');

const subTweens = subLines
  .map(
    (sub, i) => `  tl.fromTo("#sub-${i} .sub-inner", { opacity: 0, y: ${px(16)} }, { opacity: 1, y: 0, duration: 0.26, ease: "power2.out" }, ${sub.start});
  tl.to("#sub-${i} .sub-inner", { opacity: 0, y: -${px(10)}, duration: 0.24, ease: "power1.in" }, ${round(sub.start + sub.duration - 0.26)});`,
  )
  .join('\n');

const chipTweens = chips
  .map(
    (chip, i) => `  tl.fromTo("#chip-${i} .chip-inner", { opacity: 0, x: -${px(18)} }, { opacity: 1, x: 0, duration: 0.42, ease: "power2.out" }, ${chip.start});
  tl.to("#chip-${i} .chip-inner", { opacity: 0, x: -${px(12)}, duration: 0.36, ease: "power1.in" }, ${round(chip.start + chip.duration - 0.42)});`,
  )
  .join('\n');

const calloutTweens = callouts
  .map((co, i) => {
    const lines = [
      `  tl.fromTo("#co-${i} .co-body", { opacity: 0, y: ${px(18)} }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, ${co.start});`,
      `  tl.to("#co-${i} .co-body", { opacity: 0, y: ${px(12)}, duration: 0.34, ease: "power1.in" }, ${round(co.start + co.duration - 0.36)});`,
    ];
    co.items.forEach((item, j) => {
      if (item.arrow) lines.push(`  tl.fromTo("#co-item-${i}-${j}-a", { opacity: 0, x: -${px(10)} }, { opacity: 0.85, x: 0, duration: 0.3, ease: "power1.out" }, ${round(item.at - 0.22)});`);
      lines.push(`  tl.fromTo("#co-item-${i}-${j}", { opacity: 0, y: ${px(16)}, scale: 0.86 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: "back.out(1.7)" }, ${item.at});`);
    });
    const float = round(Math.max(1, (co.duration - 1.2) / 2));
    lines.push(`  tl.fromTo("#co-${i} .co-row", { y: 0 }, { y: -${px(7)}, duration: ${float}, ease: "sine.inOut", yoyo: true, repeat: 1 }, ${round(co.start + 0.6)});`);
    return lines.join('\n');
  })
  .join('\n');

const brandTweens = `  tl.fromTo("#brand", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, ${round(contentStart - 0.2)});`;

const titleTweens = `  tl.fromTo("#title-card", { opacity: 1 }, { opacity: 0, duration: 0.55, ease: "power1.inOut" }, ${round(titleSeconds - 0.1)});
  tl.fromTo("#t-kicker", { opacity: 0, y: ${px(16)} }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 0.25);
  tl.fromTo("#t-main", { opacity: 0, y: ${px(30)} }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 0.5);
  tl.fromTo("#t-sub", { opacity: 0, y: ${px(20)} }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0.95);
  tl.fromTo("#t-line", { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power2.inOut" }, 1.2);
  tl.fromTo("#t-note", { opacity: 0, y: ${px(14)} }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 1.6);
  tl.fromTo(".title-grid", { y: 0 }, { y: -${px(60)}, duration: ${round(titleSeconds + 0.55)}, ease: "none" }, 0);
  tl.fromTo(".title-glow", { opacity: 0.34 }, { opacity: 0.78, duration: ${round((titleSeconds + 0.55) / 2)}, ease: "sine.inOut", yoyo: true, repeat: 1 }, 0);`;

const outroTweens = `  tl.to("#outro-fade", { opacity: 1, duration: 0.75, ease: "power1.in" }, ${round(total - 0.8)});`;
const outroHtml = `    <div id="outro-fade" class="clip" data-start="${round(total - 0.85)}" data-duration="0.85" data-track-index="9" data-layout-allow-occlusion></div>`;

const audioHtml = hasAudio
  ? `    <audio id="voice" src="${audioSrc}" data-start="${contentStart}" data-duration="${round(partOut - partIn)}" data-track-index="20" data-volume="1"></audio>`
  : '';
const bgmHtml = hasBgm
  ? `    <audio id="bgm" src="${bgmSrc}" data-start="0" data-duration="${total}" data-track-index="21" data-volume="1"
      data-automation='${JSON.stringify({ version: 1, lanes: [{ target: 'volume', points: bgmPoints }] })}'></audio>`
  : '';

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>红创PLC代码管理系统 · 第6集（手机竖屏版）</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #070b14; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; }

      /* 竖屏底色：顶部一点品牌蓝辉光 + 极淡网格，避免大片纯黑像黑边 */
      #stage-bg { position: absolute; inset: 0; background: radial-gradient(ellipse ${px(760)}px ${px(560)}px at 50% 26%, rgba(22, 119, 255, 0.18), transparent 72%), linear-gradient(180deg, #0b1224 0%, #070b14 58%, #05070d 100%); }
      #stage-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(90, 140, 255, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(90, 140, 255, 0.07) 1px, transparent 1px); background-size: ${px(72)}px ${px(72)}px; -webkit-mask-image: radial-gradient(ellipse at 50% 30%, #000 10%, transparent 62%); }

      /* 录制视口：16:9 卡片，四周留白，放大内容不外溢到字幕带 */
      #viewport { position: absolute; left: ${VX}px; top: ${VY}px; width: ${VW}px; height: ${VH}px; overflow: hidden; border-radius: ${px(16)}px; border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: 0 ${px(20)}px ${px(56)}px rgba(0, 0, 0, 0.6); background: #05070d; }
      #cam { position: absolute; inset: 0; transform-origin: 50% 50%; }
      #cam video { position: absolute; left: 0; top: 0; width: ${VW}px; height: ${VH}px; object-fit: cover; }

      .mark { position: absolute; pointer-events: none; }
      .mark-box { position: absolute; inset: -${mk(12)}px; border: ${mk(3)}px solid #1677ff; border-radius: ${mk(14)}px; box-shadow: 0 0 0 9999px rgba(5, 10, 20, 0.32); }
      .mark-typing .mark-box { border-color: #13c2c2; box-shadow: 0 0 0 9999px rgba(5, 10, 20, 0.26); }
      .mark-frame .mark-box { border-color: #52c41a; box-shadow: 0 0 0 9999px rgba(5, 10, 20, 0.32); }
      .mark-ring { position: absolute; left: 50%; top: 50%; width: ${mk(130)}px; height: ${mk(130)}px; margin: -${mk(65)}px 0 0 -${mk(65)}px; border: ${mk(7)}px solid rgba(22, 119, 255, 0.9); border-radius: 9999px; }
      .mark-typing .mark-ring { border-color: rgba(19, 194, 194, 0.9); }

      /* 品牌带与章节角标都在录屏上方，不遮画面 */
      .brand { position: absolute; left: ${HEAD_X}px; top: ${BRAND_TOP}px; width: ${COL}px; display: flex; flex-direction: column; gap: ${px(10)}px; }
      .brand-kicker { color: #7f9ec9; font: 600 ${px(20)}px/1 system-ui, sans-serif; letter-spacing: 0.34em; }
      .brand-title { color: #eaf1ff; font: 600 ${px(28)}px/1.2 system-ui, sans-serif; letter-spacing: 0.02em; }

      .chip { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; pointer-events: none; }
      .chip-inner { position: absolute; left: ${HEAD_X}px; top: ${CHIP_TOP}px; display: flex; align-items: center; gap: ${px(9)}px; padding: ${px(9)}px ${px(16)}px ${px(9)}px ${px(13)}px; border-radius: 999px; background: rgba(9, 14, 24, 0.86); border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: 0 ${px(8)}px ${px(22)}px rgba(0, 0, 0, 0.3); }
      .chip-dot { width: ${px(9)}px; height: ${px(9)}px; border-radius: 999px; background: #1677ff; box-shadow: 0 0 0 ${px(5)}px rgba(22, 119, 255, 0.2); }
      .chip-text { color: #f2f5fa; font: 600 ${px(21)}px/1 system-ui, sans-serif; letter-spacing: 0.05em; white-space: nowrap; }

      /* 字幕带：在录制画面之外的独立区域，字号按 1080 舞台直给 */
      .sub { position: absolute; left: ${CX}px; top: ${SUB_TOP}px; width: ${COL}px; height: ${px(250)}px; display: flex; align-items: flex-start; justify-content: center; pointer-events: none; }
      .sub-inner { display: flex; flex-direction: column; align-items: center; gap: ${px(8)}px; padding: 0.3em 0.7em; border-radius: 0.4em; background: rgba(8, 12, 20, 0.88); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 ${px(10)}px ${px(26)}px rgba(0, 0, 0, 0.34); }
      .sub-line { color: #ffffff; font: 500 1em/1.42 system-ui, sans-serif; letter-spacing: 0.02em; white-space: nowrap; }

      .callout { position: absolute; left: ${CX}px; top: ${CO_TOP}px; width: ${COL}px; display: flex; justify-content: center; pointer-events: none; }
      .co-body { display: flex; flex-direction: column; align-items: center; gap: ${px(12)}px; opacity: 0; }
      .co-caption { color: #cfe0ff; font: 600 ${px(20)}px/1 system-ui, sans-serif; letter-spacing: 0.2em; text-indent: 0.2em; padding: ${px(7)}px ${px(15)}px; border-radius: 999px; background: rgba(9, 14, 24, 0.7); border: 1px solid rgba(140, 180, 255, 0.24); }
      .co-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: ${px(12)}px; }
      .co-pill { display: inline-flex; align-items: center; padding: ${px(13)}px ${px(20)}px; border-radius: 999px; font: 600 ${px(27)}px/1 system-ui, sans-serif; letter-spacing: 0.03em; color: #eaf1ff; background: rgba(12, 20, 34, 0.9); border: ${px(2)}px solid rgba(22, 119, 255, 0.75); box-shadow: 0 ${px(10)}px ${px(24)}px rgba(0, 0, 0, 0.34), inset 0 0 ${px(18)}px rgba(22, 119, 255, 0.16); opacity: 0; }
      .co-pill::before { content: ""; width: ${px(9)}px; height: ${px(9)}px; margin-right: ${px(10)}px; border-radius: 999px; background: #1677ff; box-shadow: 0 0 0 ${px(4)}px rgba(22, 119, 255, 0.22); }
      .co-warn { border-color: rgba(250, 173, 20, 0.8); color: #fff5e0; box-shadow: 0 ${px(10)}px ${px(24)}px rgba(0, 0, 0, 0.34), inset 0 0 ${px(18)}px rgba(250, 173, 20, 0.18); }
      .co-warn::before { background: #faad14; box-shadow: 0 0 0 ${px(4)}px rgba(250, 173, 20, 0.22); }
      .co-arrow { color: #9fc4ff; font: 600 ${px(26)}px/1 system-ui, sans-serif; opacity: 0; }
      .co-caret { width: 0; height: 0; border-left: ${px(10)}px solid transparent; border-right: ${px(10)}px solid transparent; border-top: ${px(10)}px solid rgba(159, 196, 255, 0.55); }

      #title-card { position: absolute; inset: 0; background: #070b14; overflow: hidden; }
      .title-bg { position: absolute; left: 0; top: -${px(120)}px; width: ${W}px; height: ${H + px(240)}px; }
      .title-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(90, 140, 255, 0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(90, 140, 255, 0.16) 1px, transparent 1px); background-size: ${px(72)}px ${px(72)}px; -webkit-mask-image: radial-gradient(ellipse at 50% 42%, #000 14%, transparent 66%); }
      .title-glow { position: absolute; left: ${px(150)}px; top: ${px(560)}px; width: ${px(780)}px; height: ${px(620)}px; background: radial-gradient(ellipse at center, rgba(22, 119, 255, 0.34), transparent 62%); }
      .title-body { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${px(24)}px; padding: ${px(220)}px ${px(70)}px; text-align: center; }
      .title-kicker { color: #7fb2ff; font: 600 ${px(24)}px/1 system-ui, sans-serif; letter-spacing: 0.4em; text-indent: 0.4em; }
      .title-main { color: #f6f9ff; font: 700 ${px(64)}px/1.14 system-ui, sans-serif; }
      .title-sub { color: #b9c6dd; font: 400 ${px(30)}px/1.4 system-ui, sans-serif; letter-spacing: 0.06em; }
      .title-line { width: ${px(300)}px; height: ${px(3)}px; background: linear-gradient(90deg, transparent, #1677ff, transparent); }
      .title-note { color: #8695ae; font: 400 ${px(21)}px/1.6 system-ui, sans-serif; letter-spacing: 0.1em; }

      #outro-fade { position: absolute; inset: 0; background: #070b14; opacity: 0; pointer-events: none; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}">
    <div id="stage-bg"></div>
    <div id="stage-grid"></div>
${brandHtml}
    <div id="viewport">
    <div class="shot" id="cam" data-layout-allow-overflow>
${videoHtml}
${markHtml}
    </div>
    </div>
${chipHtml}
${calloutHtml}
${subHtml}
${withTitle ? titleHtml : ''}
${isLastPart ? outroHtml : ''}
${audioHtml}
${bgmHtml}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${cameraMoves.join('\n')}
${brandTweens}
${markTweens}
${subTweens}
${chipTweens}
${calloutTweens}
${withTitle ? titleTweens : ''}
${isLastPart ? outroTweens : ''}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

writeFileSync(join(project, argOf('out') ?? 'index.html'), html);
console.log(`${clipSpan.id} 源窗口 ${partIn}→${partOut}s · 本段 ${total}s · 全片基准 ${fullTotal}s · 原声拍 ${inPart.length}/${beats.length} · 字幕 ${subLines.length} · 标注 ${marks.length} · 角标 ${chips.length} · 关键词组 ${callouts.length} · 人声 ${hasAudio ? '有' : '缺'} · BGM ${hasBgm ? '有' : '无'}`);
if (!hasAudio) console.warn('!! 缺少原始录音，本段将没有讲解声音 !!');
for (const beat of inPart) console.log(`  ${beat.id} 源${String(round(beat.start)).padStart(6)}→${String(round(beat.end)).padStart(6)} 本段${String(local(beat.start)).padStart(6)}→${String(round(beat.end - beat.start + local(beat.start))).padStart(6)}  ${beat.text}`);
