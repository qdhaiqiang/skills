# 流水线：录屏 → 成片

工程骨架（每集一份，从上一集拷贝最省事）：

```
videos/epN-tour/
  index.html                 # 占位，snapshot 时被临时替换成 partK.html
  assets/a.mp4               # 录屏（或软链到用户给的原文件）
  assets/audio/raw_a.wav     # 原始声轨（未处理）
  assets/audio/a.wav         # 增益对齐后的整轨
  assets/audio/<span>.wav    # 每个 span 的【真实切片】，不是软链
  assets/bgm/track.wav       # 已循环加长到 ≥ 全片秒数
  build/plan.mjs             # 分镜计划（唯一需要逐集写的文件）
  build/build.mjs            # 由 plan 生成 partK.html（跨集复用）
  build/render-parts.sh      # 逐段渲染 + 拼接（跨集复用）
  build/transcript-<span>.json
  build/probes.json          # 每镜头抽查时刻
```

## 1. 素材与时间轴

```bash
ffprobe -v error -show_entries stream=width,height,r_frame_rate -show_entries format=duration -of default=nw=1 a.mp4
```

- 先定**观看端预设**（targets.md），再定 span 切点。
- 同一集出 PC + 手机竖版（结构见 targets.md「一次出两版」）：`epN-pc/` 与 `epN-vertical/` 各一份 `build/plan.mjs`，竖版那份 `import` 手机版那份再覆盖版式参数（时间轴/分镜/坐标完全同源，`probes.json` 用 `node scripts/make-probes.mjs <工程>` 从 plan 直接生成）；录屏与 span 音频软链共用，`partN.wav` 各自重切。
- 没有上一集可抄时，两份渲染器直接取模板：`cp <skill>/assets/templates/vertical/build.mjs epN-vertical/build/build.mjs`（竖屏 9:16，含画质倍率 `Q`）与 `cp <skill>/assets/templates/landscape/build.mjs epN-pc/build/build.mjs`（16:9）；`render-parts.sh` 同目录各一份，只需按需改 `OUT_FILM`（交付名）与 `Q`。**不要手改模板里的舞台数字**——版式全部按基准 1080×1920 写、由 `Q` 缩放。
- 切点只能落在原声停顿里：先转写（第 2 步）拿到句间间隙，再挑切点。
- 一条录屏要"跳过某段画面"只能新增 span（`--print-clips` 的切点取各镜头的 `out`，改 `in` 不会真的跳过）。
- 禁止倍速压时长；旁白放不下就把源窗口延长多用真实素材。

## 2. 声音

来源三选一，开工前确认：

1. **保留原声**（录屏自带讲解时默认）：不换 TTS、不改语速。
2. **edge-tts 晓晓补录**（录屏无声/讲不清）：`scripts/tools/` 外的 `narrate.mjs` 逐句生成，字幕时间码取真实语音事件。
3. **混合**：原声为主，个别段落补录。

原声增益对齐（关键）：

```bash
ffmpeg -v error -y -i assets/a.mp4 -vn -ac 2 -ar 48000 assets/audio/raw_a.wav
python3 scripts/tools/speech-level.py assets/audio/raw_a.wav   # 量语音段与静音段各自的 RMS
```

- **处理链必须写成工程内的 `build/make-audio.sh`**（手敲的 ffmpeg 命令会失踪，下一集照抄错的旧链，第六集因此带着"闷+隆隆"交付了两版）。
- 语音链默认档（笔记本麦克风、讲话稀疏的 PC 录屏）：
  `highpass=f=110,highpass=f=110,equalizer=f=100:t=q:w=1.2:g=-8,afftdn=nr=14:nf=-36:tn=1,treble=g=4:f=2800,acompressor=threshold=0.12:ratio=2.2:attack=12:release=240:makeup=1.4,volume=<反推>dB,alimiter=limit=0.85:level=disabled`
  两级 110Hz 高通（本机构建 `highpass` 的 `poles` 上限是 2，想要 4 阶就串两次）+ 100Hz 陷波去隆隆；`afftdn` 只给 14dB 且开 `tn=1`，配 `treble` 把高频补回来。
- 增益用 `node scripts/tune-voice.mjs <已滤波未加音量.wav> <转写json>` 反推（目标语音 RMS ≈ −19.5 dBFS、峰值 ≤ −1.5 dBFS）。**不要**再手估 dB 数。
- **旧档 `highpass=f=70,afftdn=nr=24:nf=-45,volume=26dB` 已废弃**：实测把语音 2–8k 能量压掉 12 dB（听感发闷），并把 60–120Hz 残留抬到只比 250–1k 低 1.4 dB（听感就是低沉隆隆声）。
- **讲话稀疏的素材禁止整条 `loudnorm`**：它会把增益灌进静音，底噪被抬起来还随 DRC 抽吸。全程在讲的素材才可以用 `loudnorm=I=-16:TP=-1.5:LRA=11`。
- span 音频必须是真实切片：`ffmpeg -ss <span.in> -to <span.out> -i a.wav <span>.wav`（渲染脚本按"段起点 − span.in"在这个文件里切，软链到整轨会让除第一段外全部播错；第一个 span 软链到整轨则整段音画差 `span.in` 秒）。建工程后立刻按 verification.md 第 0 档逐个核对时长。
- BGM 先循环再加长再切段：`python3 scripts/tools/loop-bgm.py track.wav track.wav <titleSeconds+各span+tail>`。音量 `bgmLevels` 用 `{bed: 0.11, duck: 0.04}`（更低的档位已被接受，别回到 0.24）。
- **BGM 也要去低音**：铺底本身常把能量堆在 20–120Hz（第六集这条 20-60 相对 −14.7、60-120 相对 −4.4），叠加语音底噪就是隆隆声。`highpass=f=100,highpass=f=100,equalizer=f=170:t=q:w=1.3:g=-4`，并把未滤波原件留成 `assets/bgm/track_src.wav`，滤波永远从原件出发（否则重复切低音越切越薄）。

## 3. 转写（原声路线）

```bash
"${HF_PY:-$HOME/.venvs/hyperframes-audio/bin/python}" scripts/tools/transcribe.py assets/audio/a.wav build/transcript-a.json medium
```

- `HF_PY` = 唯一带 numpy/soundfile/faster_whisper 的解释器（本机默认 `~/.venvs/hyperframes-audio/bin/python`，换机器就 `export HF_PY=<你的 venv python>`，下文所有 `${HF_PY:-...}` 都指它）；脚本已绕开 PyAV 的 `metadata_errors` 不兼容。
- 用 `small` 再跑一遍交叉校对，行业词听错（梯形图/变量表/工单/强制推送/保持最新/Up 块…）在这里暴露，写进 `plan.textFixByIdx`。
- 一句中间停顿 > 3s 的写 `cueSplitByIdx`，拆出的子句文本走词流，需再过一遍 `plan.textPolish` 子串表。

## 4. 分镜 plan.mjs

结构见 `build/plan.mjs` 现有各集；字段：`spans / baseTranscript / titleSeconds / tailSeconds / maxZoom / moveSeconds / breath / subtitle* / bgmLevels / textFixByIdx / textPolish / cueSplitByIdx / chapters / shots[{id,span,label,in,out,camera[{at,region,maxK,pad}],marks[{at,type,region,hold}]}] / callouts[...]`。

- 坐标一律是**源录屏像素**；`at` 是该段的源秒数。
- 运镜姿态按旁白点位走（`feedback-no-page-zoom`：行驻式跟随，禁止固定位置往复缩放）。
- 静默但画面在操作 → 用 `marks`；静默且画面没操作 → 用 `callouts` 关键词浮层，别留空转。
- 点击型标注要设短 `hold`（0.35–0.5），让它在页面跳转那一帧前淡掉。
- PC 观看版不要手抄分镜：`node scripts/mk-pc-plan.mjs <绝对路径>/epN-tour/build/plan.mjs > epN-pc/build/plan.mjs` 从手机版/原始分镜派生（每镜先全貌、至多一次 ≤1.55 下探、标注每镜至多一个且存续期内不得被后续运镜甩出取景）。**生成一次后它就是交付件**，微调直接改生成出来的文件。

## 5. 抽查 → 渲染 → 拼接

```bash
mkdir -p build/html && PREP=1 bash build/render-parts.sh     # 只生成 partK.html 与音频切段
node ../../.qoder 路径/snap-shots.mjs videos/epN-tour 1 99    # 出接触表，逐框核对
bash build/render-parts.sh                                    # 正式渲染（约 60s/段 2K）
```

渲染前必须先看接触表：一次渲染 25–30 分钟，坐标错一个框就要重来。
`hyperframes check` 要求 0 error（片头背景层那条 `container_overflow` 警告是预期的）。

## 6. 平台简介文案（交付的一部分，别只交 mp4）

每集成片配一段发在 B 站/抖音简介框的介绍文字。踩过的坑：写成了**按时间轴的章节总结**被退回（用户原话："我要的视频宣传文字材料，你给我按时间总结干啥啊"），以及**一整块不换行**被退回（"好歹换个行啊，这乱糟糟的"）。口径：

- 宣传/介绍口吻：讲清这集解决什么问题、看完能做什么，**不要列 `00:00 xxx / 01:23 yyy` 时间表**。
- 2000 字以内，实际控制在 300–600 字；短段落 + 空行分隔，必要时用 `·` 列要点；简介框是纯文本，不要 Markdown 标题和星号。
- 结尾放标签行（`#红创 #PLC #Git 协作` 这种），单独成段。
- 同一集出 PC 版 + 竖版时只写一份文案，两版共用；文案落到 `videos/bilibili-简介与标签.md`，按集分节追加。
