# 踩过的坑（都对应过真实返工）

## 音频

- **span 音频软链到整轨** → 除第一个 span 外全部播错（渲染脚本按"段起点 − span.in"在该文件里切）。必须真实切片。
- **第一个 span 软链到整轨更隐蔽**：若 `span.in ≠ 0`，语音会整体**提前 `span.in` 秒**（本项目 `span a` 的 `in=0.8` → 前 8 段音差 0.8s）。能量审计和整体 ASR 都查不出来（字幕与音频出自同一模型，两者自洽），只有"音轨文件时长 == `span.out − span.in`"这条对照能查。建工程时逐个 span 核对：`ffprobe -show_entries format=duration` vs `plan.spans`，再抽一段 `silencedetect` 看首句起点是否等于 `首句时间 − span.in`。
- **稀疏语音用整条 `loudnorm`** → 增益灌进静音，底噪抬到 −18dBFS 并随 DRC 抽吸。改用语音段实测 RMS 反推固定增益。
- **BGM 没先循环加长** → 后段完全没有铺底（表现为接缝后静默段 −47dB 而不是 −35dB）。
- 只用 `volumedetect` 确认"各段有声"就宣布完成 → BGM 一直在响会掩盖缺失的人声。必须逐拍与纯铺底窗口对比。

## 度量

- `-ar 100` 重采样会把语音整段低通滤掉（同一秒差 70dB），任何自算 RMS 至少 `-ar 8000`，公式 `10*log10(mean(x^2))`；更稳的是 `silencedetect` / `astats`。
- **缩小整帧读内容两头都会错**：既"读出"过不存在的表格，也把真实存在的标签判成不存在。只信 ① 窄区域高倍放大裁剪 ② `cbox/pill/rowscan/gridcrop` 客观量具 ③ 成片帧放大中心区。
- `gridcrop.py` 的网格标签画在网格线**下方 16px**，按标签读行会整体偏一行；列表类控件要用 `rowscan.py` 数字确认，别用眼睛对齐标签。
- 4K60 录屏抽帧：`ffmpeg -skip_frame nokey -i a.mp4 -fps_mode vfr -vf scale=960:-2`（整片解码找场景切换太贵，会被打断）。
- 弹窗开合用 `magick F -colorspace gray -threshold 99% -trim -format %O info:`（有暗遮罩→包围盒小），页面归属用 `compare -metric AE A B null:`（<1000 视为同屏），能定到 ±0.2s。

## 分镜/合成

- `cueSplit` 拆出的子句绕过整句 `textFix` → 误听词漏到画面上，需要 `textPolish` 子串表；拆点若落在词中间会**吃掉首字**（"本地的修改"被拆成"地的修改"）。
- 词级时间码会漂：ASR 把一句标成 22s 长句但真词只在两头。要么 `cueSplit`，要么对可疑段重转写；**字幕窗口早于/晚于真实语音 > 1s 就要修**。
- 拆分字幕的窗口若与相邻 span 边界冲突（句子跨切点），会把半句留在上一段。切点必须落在句间。
- 标注 `at + hold` 超出镜头尾会被 build 校验拦下；`at` 落在镜头窗口外会被静默丢弃（表现为"标注 0"）。
- **标注出现时刻必须晚于运镜落幅**（`pose.at + moveSeconds`），否则框会在镜头推进途中从画外滑进来，`mark-fit` 判"存续期内出画"（第六集 S3 的两个框曾偏 72px/496px）。修法是给标注显式 `lead` 压小 + 把 `at` 挪到落幅之后，不要改 region。
- **竖屏版跑 `mark-fit` 必须带 `BAND=x,y,w,h`**（判定框是录制卡片而不是整个舞台），并配 `STAGE_W/STAGE_H`。容差随视口宽等比（960 宽取 12px：描边画在框外 6px + 框体 1.2% 呼吸 + 贴屏幕左缘的框无法再挪）。
- 竖屏版复用横屏手机版的 region/maxK 是**正确**的：`poseOf` 的区域夹紧只跟视口宽高比有关，同 16:9 视口下两版算出的 k 逐点相同（`camera-audit` 数字一模一样）。想靠加深 maxZoom 换清晰度是错的，会把标注框甩出画面。
- **自己写脚本反推相机变换，必须按 GSAP 的 `transform-origin: 50% 50%` 算**：舞台坐标 `p` 的屏幕位置是 `(p - W/2)·k + W/2 + x`，不是 `p·k + x`；`p` 已经是 `源坐标 × S`，再乘一次 S 会整体偏一倍。写完后**拿已目视验收过的旧成片跑一遍回归**：同一份手机版合成，错公式报 21/23 标注"出画"，改对后只剩 6/23 且都是 15–25px 的边缘微切（2× 运镜下可接受）——差这么多说明错的是量具不是片子。
- 点击框落在页面跳转之后 → 必须在跳转那一帧前淡出（短 `hold`）并让镜头拉远。
- `partN.html` 生成到 `build/html/`，不要放工程根，否则 `hyperframes check` 报 `multiple_root_compositions`。
- 多字符 span id（`b2`）会打断 `beat.id.slice(1)` 反推段号 → beats 里要带 `idx`。
- **工程根必须有 `index.html`**：`hyperframes render . -c build/html/partN.html` 仍会先读工程根判定"这是一个工程"，缺了直接 `✗ No composition found ... No index.html file found`，后面还会跟一句误导性的 `Chrome cannot start`。从模板拷出来的新工程没有它——跑一次 `node build/build.mjs`（不带 `--clip/--out`）就会生成。
- **`PREP=1 bash build/render-parts.sh` 结尾照样执行"拼接"**，会按 `OUT_FILM`（默认 `../<目录名>-竖版.mp4`）写出一份 ~190MB 临时成片。PREP 时显式给 `OUT_FILM=/tmp/prep.mp4` 或事后删掉，别让它冒充交付件。

## 环境（本机）

- zsh：未加引号的变量不做分词（`set -- $w`、`for spec in "a b"` 都会翻车）；失败通配（`no matches found`）会中断整条命令行。
- `montage`/`ffmpeg -tile` 需要 `-font /System/Library/Fonts/Supplemental/Arial.ttf`；`xargs montage` 会把文件名追加到输出路径后面，改用 python `subprocess.run(argv_list)`。
- 本机 ffmpeg 无 `drawtext`；`-vsync 0` 已移除用 `-fps_mode vfr`；缩放用 `-vf scale=W:-2` 不是 `-resize`。
- 长渲染前确认磁盘（2K 每段 5–10MB，整片工程 + 分段 500MB 起）；渲染被 `mediaanalysisd`/Spotlight 拖慢时先问用户，不要擅自停系统服务。
- **`✗ Chrome cannot start — Failed to run "…Google Chrome" --version (signal SIGTERM, ETIMEDOUT)` 多半是瞬时的**：`syspolicyd`/`trustd` 周期性重做签名核验时，这条探针能慢到 5–6s 被判超时——**而 `uptime` 负载可能只有 4**（不是 CPU 不够，是 exec 被卡住）。跑 `scripts/warm-chrome.sh` 把探针预热到 <1.2s 后**立刻**起渲染；不要改浏览器路径、不要杀用户的 Chrome。
- **终端画面的取景**：录屏里的终端文字块永远贴在左上（源坐标约 y 120..900）。按"整屏居中"给 region 会把命令切在左画外、右下半屏全是终端黑底（设计方原话"有用的内容没有显示，放大了一段无用的空白区域"）。用 `ink-audit.mjs` 按内容包围盒重取，别靠肉眼估；登录页/加载中这类"整屏只有一张小卡片"的画面同理。
- `hyperframes snapshot . --at` 只接受**逗号分隔**的一个字符串，空格分隔会出 0 张图。
- **ASR 对"只有键鼠声/BGM"的片段会吐固定幻觉文本**（本机实测：`MING PAO CANADA MING PAO TORONTO`、`优优独播剧场——YoYo Television Series Exclusive`）。第 4 档逐区复核时看到这类文本 = **判"无语音"放行**，不是漏字幕；只有转写出与旁白同类的中文句子才算真漏。

## 渲染的磁盘闸门与抽帧缓存

`hyperframes render` 在输出目录所在卷剩余不足约 1 GB 时会直接拒绝出段（`0.8 GB free at .../parts — Renders produce large temp files. Free disk space before rendering.`），并且 `set -e` 会让分段脚本整条中断。长片渲染前先 `df -h`，中途盯一次。

涨得最快的不是成片而是抽帧缓存 `/tmp/hyperframes-extract-cache-501`（本项目一次 24 段渲染后约 2.9 GB）。渲染停止后 `rm -rf /tmp/hyperframes-extract-cache-501/hfcache-v7-*` 是安全的：下次渲染会重新抽取，只多花几秒 extract。已交付成片的旧分段（换画质/改分镜前的 `parts/<tag>-pN.mp4`）也可以删，拼接好的成片才是唯一需要保留的产物。

## 分段渲染"静默卡死"的两种成因（2026-10-15 各踩一次，浪费 70 分钟）

现象都一样：主日志停在某段的合成信息行，`parts/` 里长时间不出文件，负载正常甚至很低。

1. **`npx hyperframes` 弹安装确认**：CLI 一发新版本，`npx` 就会打印 `Need to install the following packages: hyperframes@x.y.z / Ok to proceed? (y)` 并永久等输入。修法：`npx -y "$HF_BIN"`，`HF_BIN` 固定到已验收成片所用版本（升级要显式改，别让它悄悄换渲染器）。
2. **NPS 问卷等 TTY 输入**：`hyperframes render` 每累计 15 次成功渲染会问 `How likely are you to recommend HyperFrames?`，只在 `process.stdin.isTTY` 为真时才问——而 tmux 里 stdin 就是 TTY。修法：渲染命令加 `< /dev/null`（或设 `CI=1`）。

诊断与预防：**不要把渲染输出接进 `| tail -3`**（管道会吞掉整段提示，卡死时什么都看不见）。改成每段落盘 `> /tmp/part$i.log 2>&1` 再 tail，轮询时看这个文件；再配一条判活命令：

```bash
pgrep -f "hyperframes render" >/dev/null && ps -eo pid,ppid,pcpu,etime,comm | awk '$2==<npmPid} && $3<1'  # npm 父进程 0% CPU 且无子进程 = 已卡死
```

卡死后 `tmux kill-session` + `pkill -f "hyperframes render"`，换 `TAG` 重跑（旧 TAG 的分段会被跳过，别复用）。
