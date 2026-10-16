// 由 plan.mjs + 各段转写 JSON 生成 index.html —— 16:9 舞台版（PC 观看版；旧的手机横屏版同一份）
// 用法: node build/build.mjs [--clip=段id,源起,源止] [--out=partN.html] [--audio=...] [--bgm=...] [--print-clips=N]
// 工程内只改两处：plan.mjs 的字段、render-parts.sh 的输出名；版式与运镜算法不要改。
// 用法: node build/build.mjs [--clip=段id,源起,源止] [--out=partN.html] [--audio=...] [--bgm=...] [--print-clips=N]
// 每段录屏按 in/out + data-media-start 直接引用，1.0x 原速，不剪切、不变速。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan } from './plan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, '..');

const W = 2560;
const H = 1440;
const SRC_W = 4480;
const S = W / SRC_W;
// 版式尺寸仍按 1920 舞台来设计，用 U 等比放大到当前舞台，换分辨率不必重调视觉。
const U = W / 1920;
const px = (n) => Math.round(n * U);
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

/* ---------- 2. 运镜姿态 ---------- */
const poseOf = (pose) => {
  const region = pose?.region;
  if (!region) return { k: 1, x: 0, y: 0 };
  const [rx, ry, rw, rh] = region;
  const pad = pose.pad ?? 26;
  const sw = (rw + pad * 2) * S;
  const sh = (rh + pad * 2) * S;
  const k = Math.max(1, Math.min(pose.maxK ?? MAX_K, Math.min(W / sw, H / sh)));
  const halfW = W / (2 * k);
  const halfH = H / (2 * k);
  const cx = Math.min(W - halfW, Math.max(halfW, (rx + rw / 2) * S));
  const cy = Math.min(H - halfH, Math.max(halfH, (ry + rh / 2) * S));
  return { k: round(k, 3), x: round((W / 2 - cx) * k), y: round((H / 2 - cy) * k) };
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

/* ---------- 3. 交互标注 ---------- */
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
const wrapCJK = (text, maxLines) => {
  const target = widthOf(text) / maxLines;
  const lines = [];
  let current = '';
  let acc2 = 0;
  for (const ch of text) {
    current += ch;
    acc2 += WIDTH_RE.test(ch) ? 1 : 0.55;
    if (acc2 >= target && CJK_BREAK.test(ch) && lines.length < maxLines - 1) {
      lines.push(current);
      current = '';
      acc2 = 0;
    }
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
for (const sub of subLines) {
  const units = widthOf(sub.text);
  const maxWidth = px(plan.subtitleWidth ?? 1440);
  const oneLine = Math.floor(maxWidth / units);
  if (oneLine >= px(plan.subtitleMin ?? 34)) {
    sub.size = Math.min(px(plan.subtitleMax ?? 46), oneLine);
    sub.lines = [sub.text];
  } else {
    sub.lines = wrapCJK(sub.text, 2);
    const widest = Math.max(...sub.lines.map(widthOf));
    sub.size = Math.min(px(plan.subtitleMax ?? 46), Math.floor(maxWidth / widest));
  }
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

const titleHtml = `    <section id="title-card" class="clip" data-start="0" data-duration="${round(titleSeconds + 0.55)}" data-track-index="8">
      <div class="title-bg"><div class="title-grid"></div><div class="title-glow"></div></div>
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
    (sub, i) => `  tl.fromTo("#sub-${i} .sub-inner", { opacity: 0, y: ${px(18)} }, { opacity: 1, y: 0, duration: 0.26, ease: "power2.out" }, ${sub.start});
  tl.to("#sub-${i} .sub-inner", { opacity: 0, y: -${px(10)}, duration: 0.24, ease: "power1.in" }, ${round(sub.start + sub.duration - 0.26)});`,
  )
  .join('\n');

const chipTweens = chips
  .map(
    (chip, i) => `  tl.fromTo("#chip-${i} .chip-inner", { opacity: 0, x: -${px(20)} }, { opacity: 1, x: 0, duration: 0.42, ease: "power2.out" }, ${chip.start});
  tl.to("#chip-${i} .chip-inner", { opacity: 0, x: -${px(14)}, duration: 0.36, ease: "power1.in" }, ${round(chip.start + chip.duration - 0.42)});`,
  )
  .join('\n');

const calloutTweens = callouts
  .map((co, i) => {
    const lines = [
      `  tl.fromTo("#co-${i} .co-body", { opacity: 0, y: ${px(22)} }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, ${co.start});`,
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

const titleTweens = `  tl.fromTo("#title-card", { opacity: 1 }, { opacity: 0, duration: 0.55, ease: "power1.inOut" }, ${round(titleSeconds - 0.1)});
  tl.fromTo("#t-kicker", { opacity: 0, y: ${px(18)} }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 0.25);
  tl.fromTo("#t-main", { opacity: 0, y: ${px(34)} }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 0.5);
  tl.fromTo("#t-sub", { opacity: 0, y: ${px(22)} }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0.95);
  tl.fromTo("#t-line", { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power2.inOut" }, 1.2);
  tl.fromTo("#t-note", { opacity: 0, y: ${px(16)} }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 1.6);
  tl.fromTo(".title-grid", { y: 0 }, { y: -${px(64)}, duration: ${round(titleSeconds + 0.55)}, ease: "none" }, 0);
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
    <title>红创PLC代码管理系统 · 第5集</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0b0f14; }
      html::after { content: ""; display: block; height: ${px(1200)}px; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; }
      .shot { position: absolute; inset: 0; }
      .shot video { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; object-fit: cover; transform-origin: 50% 50%; }

      .mark { position: absolute; pointer-events: none; }
      .mark-box { position: absolute; inset: -${px(12)}px; border: ${px(3)}px solid #1677ff; border-radius: ${px(14)}px; box-shadow: 0 0 0 9999px rgba(5, 10, 20, 0.32); }
      .mark-typing .mark-box { border-color: #13c2c2; box-shadow: 0 0 0 9999px rgba(5, 10, 20, 0.26); }
      .mark-frame .mark-box { border-color: #52c41a; box-shadow: 0 0 0 9999px rgba(5, 10, 20, 0.32); }
      .mark-ring { position: absolute; left: 50%; top: 50%; width: ${px(130)}px; height: ${px(130)}px; margin: -${px(65)}px 0 0 -${px(65)}px; border: ${px(7)}px solid rgba(22, 119, 255, 0.9); border-radius: 9999px; }
      .mark-typing .mark-ring { border-color: rgba(19, 194, 194, 0.9); }

      .chip { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; pointer-events: none; }
      .chip-inner { position: absolute; left: ${px(44)}px; top: ${px(40)}px; display: flex; align-items: center; gap: ${px(12)}px; padding: ${px(13)}px ${px(24)}px ${px(13)}px ${px(19)}px; border-radius: 999px; background: rgba(9, 14, 24, 0.82); border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 ${px(10)}px ${px(30)}px rgba(0, 0, 0, 0.28); }
      .chip-dot { width: ${px(12)}px; height: ${px(12)}px; border-radius: 999px; background: #1677ff; box-shadow: 0 0 0 ${px(6)}px rgba(22, 119, 255, 0.2); }
      .chip-text { color: #f2f5fa; font: 600 ${px(27)}px/1 system-ui, sans-serif; letter-spacing: 0.05em; white-space: nowrap; }

      .sub { position: absolute; left: 0; bottom: ${px(40)}px; width: ${W}px; height: ${px(240)}px; display: flex; align-items: flex-end; justify-content: center; pointer-events: none; }
      .sub-inner { display: flex; flex-direction: column; align-items: center; gap: ${px(8)}px; padding: 0.3em 0.85em; border-radius: 0.4em; background: rgba(8, 12, 20, 0.8); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 ${px(12)}px ${px(34)}px rgba(0, 0, 0, 0.3); }
      .sub-line { color: #ffffff; font: 500 1em/1.42 system-ui, sans-serif; letter-spacing: 0.02em; white-space: nowrap; }

      .callout { position: absolute; left: 0; bottom: ${px(258)}px; width: ${W}px; display: flex; justify-content: center; pointer-events: none; }
      .co-body { display: flex; flex-direction: column; align-items: center; gap: ${px(12)}px; opacity: 0; }
      .co-caption { color: #cfe0ff; font: 600 ${px(24)}px/1 system-ui, sans-serif; letter-spacing: 0.22em; text-indent: 0.22em; padding: ${px(7)}px ${px(18)}px; border-radius: 999px; background: rgba(9, 14, 24, 0.6); border: 1px solid rgba(140, 180, 255, 0.22); }
      .co-row { display: flex; align-items: center; gap: ${px(16)}px; }
      .co-pill { display: inline-flex; align-items: center; padding: ${px(15)}px ${px(30)}px; border-radius: 999px; font: 600 ${px(34)}px/1 system-ui, sans-serif; letter-spacing: 0.04em; color: #eaf1ff; background: rgba(12, 20, 34, 0.86); border: ${px(2)}px solid rgba(22, 119, 255, 0.75); box-shadow: 0 ${px(12)}px ${px(30)}px rgba(0, 0, 0, 0.34), inset 0 0 ${px(24)}px rgba(22, 119, 255, 0.16); opacity: 0; }
      .co-pill::before { content: ""; width: ${px(11)}px; height: ${px(11)}px; margin-right: ${px(13)}px; border-radius: 999px; background: #1677ff; box-shadow: 0 0 0 ${px(5)}px rgba(22, 119, 255, 0.22); }
      .co-warn { border-color: rgba(250, 173, 20, 0.8); color: #fff5e0; box-shadow: 0 ${px(12)}px ${px(30)}px rgba(0, 0, 0, 0.34), inset 0 0 ${px(24)}px rgba(250, 173, 20, 0.18); }
      .co-warn::before { background: #faad14; box-shadow: 0 0 0 ${px(5)}px rgba(250, 173, 20, 0.22); }
      .co-arrow { color: #9fc4ff; font: 600 ${px(36)}px/1 system-ui, sans-serif; opacity: 0; }
      .co-caret { width: 0; height: 0; border-left: ${px(13)}px solid transparent; border-right: ${px(13)}px solid transparent; border-top: ${px(13)}px solid rgba(159, 196, 255, 0.55); }

      #title-card { position: absolute; inset: 0; background: #070b14; overflow: hidden; }
      .title-bg { position: absolute; left: 0; top: -${px(120)}px; width: ${W}px; height: ${H + px(240)}px; }
      .title-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(90, 140, 255, 0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(90, 140, 255, 0.16) 1px, transparent 1px); background-size: ${px(96)}px ${px(96)}px; -webkit-mask-image: radial-gradient(ellipse at 50% 45%, #000 18%, transparent 72%); }
      .title-glow { position: absolute; left: ${px(360)}px; top: ${px(190)}px; width: ${px(1200)}px; height: ${px(700)}px; background: radial-gradient(ellipse at center, rgba(22, 119, 255, 0.34), transparent 62%); }
      .title-body { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${px(26)}px; }
      .title-kicker { color: #7fb2ff; font: 600 ${px(30)}px/1 system-ui, sans-serif; letter-spacing: 0.42em; text-indent: 0.42em; }
      .title-main { color: #f6f9ff; font: 700 ${px(92)}px/1.1 system-ui, sans-serif; }
      .title-sub { color: #b9c6dd; font: 400 ${px(40)}px/1 system-ui, sans-serif; letter-spacing: 0.12em; }
      .title-line { width: ${px(420)}px; height: ${px(3)}px; background: linear-gradient(90deg, transparent, #1677ff, transparent); }
      .title-note { color: #8695ae; font: 400 ${px(27)}px/1 system-ui, sans-serif; letter-spacing: 0.18em; }

      #outro-fade { position: absolute; inset: 0; background: #0b0f14; opacity: 0; pointer-events: none; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}">
    <div class="shot" id="cam">
${videoHtml}
${markHtml}
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
for (const beat of inPart) console.log(`  ${beat.id} 源${String(round(beat.start)).padStart(6)}→${String(round(beat.end)).padStart(6)} 本段${String(local(beat.start)).padStart(6)}→${String(local(beat.end)).padStart(6)}  ${beat.text}`);
