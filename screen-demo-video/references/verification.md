# 交付前验收（缺一不可）

顺序执行；任何一项不过就不算完成，也不要把决定权交回用户。

## 0. 素材对照：每个 span 的音频是真实切片

```bash
node -e 'import("./build/plan.mjs").then(({plan})=>plan.spans.forEach(s=>console.log(s.id,(s.out-s.in).toFixed(3))))' \
  | while read id want; do printf "%-4s %s\n" "$id" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 assets/audio/$id.wav)"; done
```

两个数必须相等（±0.05）。再抽第一段验语音起点：`ffmpeg -i assets/audio/part1.wav -af silencedetect=noise=-30dB:d=0.25 -f null -`，首个 `silence_end` 减 0.25 应等于"第一句时间码 − span.in"。
**为什么单列一档**：软链到整轨时，除首段外的窗口会播到录音开头（ASR 回读能抓到），而首段若 `span.in≠0` 只是音画差几百毫秒，能量与 ASR 两道都自洽查不出（第六集手机版正是 0.8s）。

## 1. 规格

```bash
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,sample_rate,channels -show_entries format=duration,size,bit_rate -of default=nw=1 <成片.mp4>
```
期望：PC 版 2560×1440@30、手机竖版 **2160×3840**@30（版式基准 1080×1920 × Q=2）、H.264 + AAC 48k 立体声、时长与 `titleSeconds+Σspan+tail` 吻合、体积合理（2K 约 0.6 MB/s）。

## 1b. 清晰度量化（竖版必查，被退回过一次）

```
录屏显示比例   = 录制视口宽 / 源录屏宽            # 竖版 Q=2: 1920/4480 = 0.43；Q=1 只有 0.21 = 不合格
每录制像素比特 = 视频码率 x 时长 / (视口宽 x 视口高 x 总帧数)
```

两个数都要和同集 16:9 版对照后写进交付说明。显示比例低于 0.40 就是「电脑 1:1 打开看不清」，解法是提 `Q`，不是加码率、也不是加深 `maxZoom`（见 targets.md「为什么竖版必须 Q>=2」）。第六集实测：横屏 0.57 / 0.043 bit、竖版 Q=1 0.21 / 0.101（退回）、竖版 Q=2 0.43 / 0.071。

## 2. 整体 ASR 回读（最关键，能抓出能量审计抓不到的错）

```bash
ffmpeg -hide_banner -nostats -y -i <成片.mp4> -vn -ac 1 -ar 16000 /tmp/film.wav
# HF_PY 见 pipeline.md §3；未设置时用默认 venv
"${HF_PY:-$HOME/.venvs/hyperframes-audio/bin/python}" - <<'PY'
import numpy as np, soundfile as sf
from faster_whisper import WhisperModel
a,_=sf.read('/tmp/film.wav',dtype='float32')
m=WhisperModel('medium',device='cpu',compute_type='int8',cpu_threads=8)
segs,_=m.transcribe(np.ascontiguousarray(a),language='zh',beam_size=5,vad_filter=True,vad_parameters={'min_silence_duration_ms':300})
for s in segs: print(f"{s.start:7.2f} -> {s.end:7.2f}  {s.text.strip()}")
PY
```
比对：句子**条数、顺序、结束时刻**要与 plan 一致。第六集就是靠这一步发现"除第一个 span 外每个镜头播的都是录音开头十几秒"——逐拍能量审计当时全部误判通过（那里确实有语音）。

## 3. 逐拍能量

```bash
node scripts/verify-beats.mjs videos/epN-tour <成片.mp4>
```
合格线（实测）：旁白句均值 −17 … −27 dB、峰值 −3 … −12 dB；纯铺底 −34 … −37 dB；收尾淡出 ≤ −44 dB。
**这个下限是"混音前"的**：合成里有一条固定增益，实测同一窗口 `源 span 切片 − 成片` 恒为 **3.00 dB**（第六集 35 句、第六集(下) 37 句，全部落在 2.7–3.0），所以成片侧的均值下限是 −24 dB。按 −27 硬卡，每集都会假报 2–3 句"人声偏轻"。判"人声没混进去"要看**同窗口源−成片差是否恒等于混音增益**（差 >5dB 或某句差值离群才是真丢），不看绝对值：本集三句 −27.3/−28.0/−27.4 的源侧实测 −24.4/−25.2/−24.5，比铺底（−39.5）高 12dB 以上，属说话本身轻。
**旁白句均值若低于铺底窗口 = 人声没混进去**，立刻回查音频，不要靠 BGM 在响就宣布有声。

## 4. 有声无字幕

```bash
node scripts/scan-voice.mjs videos/epN-tour <成片.mp4>
```
对每一处待确认，把**源音频同秒切片**重跑 ASR：

```bash
ffmpeg -hide_banner -nostats -y -ss <a> -t <b-a> -i assets/audio/a.wav -ac 1 -ar 16000 /tmp/g.wav
# 再用 medium 转写 /tmp/g.wav；返回"无语音"即为键盘/鼠标点击，可放行
```
不要自己按 `-ar 100` 算 RMS（见 pitfalls）。

## 5. 接缝与铺底

每个 span 边界两侧各量 1.2s，均值差应 ≤ 3 dB 且无突跳；`silence_end` 不应出现在接缝上（说明切点落进了语音里）。

## 6. 标注落点与运镜节奏

渲染前用 `snap-shots.mjs` 出接触表逐框看；交付后再从**成片**按标注时刻抽全分辨率帧复核（`ffmpeg -ss <成片秒> -i 成片.mp4 -frames:v 1`），确认每个框压在真实文字/按钮上。

两道客观对照（PREP 出完 `build/html/partN.html` 就能跑，不用等渲染）：

```bash
node scripts/mark-fit.mjs videos/epN-<slug>      # 标注矩形在其存续期内是否完整在舞台内（出画 0 个）
node scripts/camera-audit.mjs videos/epN-<slug>  # 运镜次数/分钟、k≈1 全貌占比、k>阈值占比、最长看不到全貌秒数
node scripts/ink-audit.mjs videos/epN-<slug>     # 每个姿态落幅时"视口里有多少是空白 / 内容被切多少"
```

`ink-audit` 是专门对付"**有用的内容没有显示，放大了一段无用的空白区域**"这类反馈的：它按 `poseOf` 同样的算法算出每个姿态落幅时可见的源矩形，从源录屏裁出整屏内容包围盒（`magick -fuzz N% -format %@`），报两个数——`视口空白`（视口里没内容的比例）和 `内容被切`（内容盒落在视口外的比例）。**合格线：视口空白 ≤ 0.45**；内容盒本来就比视口大（整页/整屏表格）时 `内容被切` 大是正常的（放大本来就看局部），只有内容盒比视口小却被切才要改。建议的 `region` 直接按内容盒给，改完再跑一次直到不报警。
终端类画面最容易踩：文字块永远在左上（y 120..900），按"整屏居中"取景会把文字切在左画外、右下半屏全是黑底——region 要贴着文字块给，而不是按屏幕中心。

竖屏版必须带 `BAND`（录屏只占舞台里的一张卡片，判定框是卡片矩形而不是整个舞台），且 `STAGE_*`/`BAND` 要用**放大后的实际舞台**（Q=2 时全部 ×2）：

```bash
STAGE_W=2160 STAGE_H=3840 BAND=120,880,1920,1080 node scripts/mark-fit.mjs videos/epN-vertical
```

`camera-audit` 用来证明选定的观看端预设真的落地：手机版允许高频下探，PC 版必须满足 targets.md 的自检线（k>1.5 占比 ≤35%、每 20s 内有一次全貌）。同一集两个版本各跑一次，把两组数字写进交付说明，比"看起来不晃了"可靠。

竖屏版还有三条只在这一档查：
- **字幕字号必须全片唯一，且没有一行超出字幕带宽度**：PREP 后统计各 `build/html/partN.html` 里 `sub-inner` 的 `font-size`（只能有一个值）与每行字宽（`CJK=1 / 半角=0.56 / 空格=0.34`，上限 `(subtitleWidth-28)/字号`），并确认**没有一行以句读开头**（`，。；：、！？）` 领行 = 缺避头点，会把"。"单独甩成第三行）。断行规则：按字宽贪心，遇到放不下的句读就让它留在本行末尾（宁可该行略宽 1 个字），否则折行数会莫名多出一行。第六集第一次重渲只关了缩字号，结果 47 行里 10 行超宽、最长 26 单位 ≈ 2496px 直接顶出 2160 舞台——因为旧的 `wrapCJK` 只在标点处断、找不到标点就把整句塞成一行。**固定字号必须配按字宽贪心断行**。
- **顶部文字位置**：品牌带/章节角标左边缘 ≥ 舞台宽 11%（2160 即 ≥240px）、角标下沿与录制卡片上沿间隙 ≥ 30Q，且不得压到 app 的返回箭头/搜索图标那一行（基准 y<200）。
- **右侧安全区**：录制卡片以下的所有文字（字幕/关键词/角标）右边缘 ≤ 舞台宽 88%（1080 舞台即 x≤950），否则播放时被 app 的点赞/评论竖排压住。快照接触表上量一次即可。
- **字幕带位置**：抽 3 帧量字幕文字包围盒，顶边要低于录制卡片下沿（不与录屏重叠）、离卡片 ≤ 舞台高 1.6%（3840 高即 ≤60px）、水平中心与舞台中心偏差 ≤ 舞台宽 1.5%（2160 宽即 ≤32px；实测 28px 来自字形侧边距，属正常）。

## 7. 音质对照（"声音不纯 / 有隆隆声"就靠这一档定位）

```bash
node scripts/audio-metrics.mjs <转写json> <该音频相对转写的时间偏移> <音频1> [音频2 ...]
```

一次给出每条音轨的：语音 RMS、峰值、停顿底噪 RMS、语音与停顿的 8 段频谱、`隆隆指数`（停顿 20–120Hz 减 250–1k）、`亮度`（语音 2–8k 减 0.12–2k）、`底噪−语音`。

判读口径（第六集实测）：
- **亮度**必须与原片接近（原始 −23.4 dB；旧链做出 −35.2 dB = 高频被 `afftdn` 吃掉 12 dB，听感发闷；新链 −21.5…−23.5 dB ✓）。
- **隆隆指数**要明显为负（原始 +7.9、旧链 −1.4 = 60–120Hz 残留与中频齐平，听感就是低沉隆隆；新链 −13.8…−15.6 ✓）。
- **停顿底噪**看绝对值没用（成片里被 BGM 铺底盖住），要看它与语音的差值以及低频占比。
- 对照必须**同时量 BGM**：铺底自身的 20–120Hz 能量常比中频还高，是隆隆声的另一半来源。
- 时间偏移参数用来对齐"转写是整轨时间、音频是切片"的情况（例：切片从 `span.in=0.8` 开始就传 `0.8`）。
