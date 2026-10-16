---
name: screen-demo-video
description: 把软件操作录屏（PC 录屏、后台/IDE/PLC 工具演示）做成带中文旁白、逐句字幕、行驻式运镜与控件标注的讲解视频。用户提供录屏文件并要求"处理第 N 集/做成讲解视频/加字幕加旁白"，或要求把已有录屏改造成 PC 观看版/手机观看版时使用。沉淀本项目的流水线：span 切分与静音切点、原声增益对齐、faster-whisper 真实时间码、plan.mjs 分镜与 HyperFrames 分段渲染、以及交付前的七道验收（素材对照、整体 ASR 回读、逐拍能量、有声无字幕、接缝、铺底、标注落点与运镜节奏、音质对照）。
---

# 软件操作录屏 → 讲解视频

## Overview

输入一段（或多段）PC 软件操作录屏，输出 16:9 成片：真实操作画面 + 原声（或补录旁白）+ 逐句字幕 + 跟随讲解重点的镜头推拉 + 压在真实控件上的高亮框。合成层用 HyperFrames（HTML Composition），本 skill 负责这条业务流水线与验收口径；写合成语法本身仍参照 `/hyperframes-core` 与 `/hyperframes-animation`。

## 第一步：确认两件事（用户没说就必须问，不要猜）

1. **观看端：PC 还是手机？手机默认竖屏 9:16。** 这决定画幅、版式与运镜密度，是本 skill 最重要的分叉：
   - 手机（竖屏，**手机版唯一交付形态**）：文字小，需要频繁下探到正在讲的那一行/那一个控件；**字幕不许压在录制画面上**，要放在录制卡片下方的独立字幕带里，录制卡片两侧与底部要留出全面屏 UI 的空间。**舞台不能只做 1080×1920**——录制卡片宽度被舞台宽度钳死，1080 舞台里 4480 宽的录屏只剩 0.21 倍显示比例，电脑上 1:1 打开看不清；默认按 **2160×3840（画质倍率 Q=2）** 出片，见 targets.md「为什么竖版必须 Q≥2」。两条设计方硬口径：**字幕全片固定字号**（文字长了换行，绝不按行长缩字号）；**顶部品牌带/章节角标不贴左上角**（从视口左边再缩进 60、往下挪，别和 app 的返回箭头挤在一行）。
   - PC（2560×1440）：全貌本来就看得清，频繁局部放大会被读成"一直在晃"、并且失去页面布局参照。**每个镜头先给 1.5–2.5s 全貌**，下探不超过 2 次、倍率 ≤1.6，看完回全貌。
   - 用户没提 → 提问；用户说"都要"或拿不准 → **一次出两版**：`第N集-…-PC版.mp4` + `第N集-…-手机竖版.mp4`（手机横屏版不再默认交付）。工程结构、先后顺序与成本见 targets.md「一次出两版」。
   - 具体数值见 `references/targets.md`。历史各集（ep2–ep6）都是按"手机=横屏 16:9、字幕压在画面内"做的，已被设计方退回（竖屏播放时上下黑边 + 字幕挤在画面上看不清），要发手机需按竖屏预设重做版式（音频与分镜不用动）。旧集在 PC 上放则按 pc 预设重做运镜。
2. **声音来源**：保留原声（录屏自带讲解时的默认）/ 晓晓 TTS 补录（无声或讲不清）/ 混合。原声路线**不换声、不变速**，字幕必须由原声转写出的真实词级时间码驱动。

其余默认值（不要再逐项追问）：2560×1440@30、真实录屏一律 1.0× 不倍速、宁长勿压缩、字幕居中单行优先最多两行、BGM `bed 0.11 / duck 0.04`、片头渐入标题卡 + 动态背景、章节角标、关键词浮层。

## 硬性口径（违反过、都被退回过）

- **禁止倍速**压时长；要缩短只能按段落裁，且切点落在原声停顿里。
- 功能点全覆盖（左侧菜单每个点都要真演示），但单点从简，一两句话讲完。
- 每个放大框/点击框必须压在**真实文字或按钮**上，坐标按源帧实测，交付前逐个核对。
- 画面没有操作的静默段不能空转：做关键词浮层（随语音逐个弹入 + 指向字幕的小三角）。
- 交付前必须证明旁白真的混进成片：逐拍能量与纯铺底窗口对比（BGM 一直响会掩盖人声缺失）。
- 长渲染盯到出结果再回报；期间只报进度与真正变化的信息。

## 流水线

```
1 素材勘查 → 2 定 span 切点 → 3 音频（增益对齐 + 逐 span 真实切片 + BGM 加长）
4 转写（词级时间码 + 交叉校对）→ 5 写 build/plan.mjs → 6 PREP 生成 partK.html
7 snap-shots 出接触表逐框核对 → 8 正式渲染 → 9 七道验收 → 10 交付
```

命令与细节见 `references/pipeline.md`。可复用代码在本 skill 的 `scripts/`：

| 脚本 | 用途 |
| --- | --- |
| `scripts/tools/transcribe.py` | faster-whisper 词级转写（绕开 PyAV 不兼容），输出 `build/transcript-*.json` |
| `scripts/tools/speech-level.py` | 量语音段/静音段 RMS，用来反推固定增益 |
| `scripts/tools/loop-bgm.py` | 交叉淡化把 BGM 循环加长到目标秒数（**必须在切段前做**） |
| `scripts/tools/cbox.py` `pill.py` `rowscan.py` `gridcrop.py` `measure.py` `findcolor.py` | 按颜色谓词/墨迹分布量控件包围盒（源像素坐标） |
| `scripts/snap-shots.mjs` | 按 `build/probes.json` 把每镜头代表时刻渲染成接触表，逐框核对 |
| `scripts/make-probes.mjs` | 由 plan 自动生成 `build/probes.json`（镜头开头 / 每次落幅后 / 每个标注后，去重取前 4） |
| `scripts/mark-fit.mjs` | 解析合成的相机关键帧，算标注存续期内是否出画（PREP 后即可跑；竖版要带 `BAND=x,y,w,h`） |
| `scripts/camera-audit.mjs` | 运镜节奏量化：次/分钟、全貌占比、深放大占比、最长看不到全貌秒数 |
| `scripts/ink-audit.mjs` | 逐姿态量"视口里有多少空白 / 内容被切多少"，治"放大了一段无用空白" |
| `scripts/warm-chrome.sh` | 渲染前把 Chrome 探针预热到秒级，避开 `Chrome cannot start` 瞬时超时 |
| `scripts/verify-beats.mjs` | 逐拍能量 + 纯铺底对照 |
| `scripts/audio-metrics.mjs` | 音质对照：语音/底噪 RMS、8 段频谱、隆隆指数、亮度（诊断"发闷/隆隆声"） |
| `scripts/mark-shots.mjs` | 从成片按标注在屏幕上的真实位置裁图，逐张核对落点 |
| `scripts/scan-voice.mjs` | "有声但没字幕"扫描（silencedetect 求有声区间） |
| `scripts/tune-voice.mjs` | 由已滤波语音轨反推固定增益 dB（目标语音 RMS 与峰值余量），替代手估 |
| `scripts/mk-pc-plan.mjs` | 由手机版/原始 plan 派生 PC 观看版 plan（全貌优先、至多一次下探、标注收密度）；生成后即为交付件 |

工程骨架优先从上一集拷贝；没有可抄的上一集时用本 skill 模板：`assets/templates/landscape/{build.mjs,render-parts.sh}`（16:9 / PC 版）与 `assets/templates/vertical/{build.mjs,render-parts.sh}`（手机竖屏 9:16，已内置画质倍率 `Q`、`TAG` 分段前缀、`OUT_FILM`）；`build/make-audio.sh` 仍要每集落地一份（**音频链必须写成 `build/make-audio.sh` 留在工程里**，手敲 ffmpeg 命令会让下一集照抄到失踪的旧链）；新仓库第一次用时把 `scripts/tools/` 复制成项目内的 `videos/work/tools/`。竖屏版另起一份工程：`build/plan.mjs` 直接 `import` 手机版那份再覆盖版式参数，`build/build.mjs` 用上面的 vertical 模板，不要手改舞台数字——版式全部走 `Q`。

**长渲染必须用 `tmux new-session -d` 起，渲染命令必须写成 `npx -y "$HF_BIN" … < /dev/null`**（少 `-y` 会被 npx 的新版本安装确认卡住，少 `< /dev/null` 会被 CLI 每 15 次渲染弹一次的 NPS 问卷卡住——两种都是整条流水线静默卡死），每段日志单独落盘再看，别接 `| tail`：`hyperframes render` 有父进程看门狗，`nohup … &` 一断就 `Render cancelled: render_cancelled_parent_exited`，整段不出。

## 验收（七道，缺一不可）

按 `references/verification.md` 顺序跑：**素材对照（span 音频是真实切片）→ 规格 → 整体 ASR 回读 → 逐拍能量 → 有声无字幕 → 接缝/铺底 → 标注落点与运镜节奏 → 音质对照（亮度/隆隆指数/底噪）**。

其中"整体 ASR 回读"最容易被跳过、却抓到过最大的问题（音频错切导致后半段旁白变成重复的开场白，而能量审计全部误判通过）。合格线都写在该文件里。

## 排错入口

`references/pitfalls.md`：音频（软链整轨、loudnorm 抬底噪、BGM 未加长）、度量（`-ar 100` 把语音滤没、缩小整帧读内容会读错、gridcrop 标签偏一行）、分镜（cueSplit 吃首字、标注超窗被丢、点击框落在跳转后）、本机环境（zsh 分词与通配、ffmpeg 选项差异、snapshot 只吃逗号分隔时刻、渲染前查磁盘）。
