#!/usr/bin/env bash
# 分段渲染（16:9 舞台（PC 版））：按镜头边界切段（每段=一段录屏的一个源窗口），最后无损拼接。
# 用法: build/render-parts.sh [起始段号]   （默认从 1 开始；已存在的段自动跳过）
# PREP=1 只生成 build/html/partN.html 与音频切片，不渲染，便于先跑量具与接触表。
set -euo pipefail

cd "$(dirname "$0")/.."
FROM="${1:-1}"
TAG="${TAG:-$(basename "$PWD")}"   # 分段文件前缀；parts/ 是多集共用目录，别用通用名
OUT_DIR="../parts"
# npx 不加 -y：CLI 一发新版本就会在 "Ok to proceed? (y)" 上永久等待；stdin 不给 /dev/null：tmux 里 stdin 是 TTY，
# CLI 每 15 次成功渲染弹一次 NPS 问卷 → 两种都是整条流水线静默卡死。HF_BIN 固定在已验收版本，升级要显式改。
HF_BIN="${HF_BIN:-hyperframes@0.8.157}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$OUT_DIR" build/html

PIECES=()
while IFS= read -r line; do PIECES+=("$line"); done < <(node build/build.mjs --print-clips=1)
N=${#PIECES[@]}
echo "共 $N 段"

for i in $(seq "$FROM" "$N"); do
  piece="${PIECES[$((i - 1))]}"
  sid="${piece%%,*}"
  rest="${piece#*,}"
  a="${rest%,*}"
  b="${rest#*,}"
  dur=$(node -e "console.log(($b - $a).toFixed(2))")
  target="$OUT_DIR/$TAG-p$i.mp4"
  if [ -f "$target" ] && [ "${PREP:-0}" != "1" ]; then
    echo "== 第 $i 段已存在，跳过 ($piece)"
    continue
  fi
  echo "== 第 $i 段 源 $sid [$a,$b] (${dur}s)"
  # 人声：从该窗口自己的音轨文件按源秒切（音轨索引 0 = span.in），必须是真实切片。
  voice_from=$(node -e "import('./build/plan.mjs').then(({plan})=>console.log($a - plan.spans.find(s=>s.id==='$sid').in))")
  ffmpeg -v error -y -ss "$voice_from" -t "$dur" -i "assets/audio/$sid.wav" -ar 48000 -ac 2 "assets/audio/part$i.wav"
  # BGM：按成片时间切（第 1 段从 0 开始含片头）
  bgm_from=$(node -e "import('./build/plan.mjs').then(({plan})=>{const sp=plan.spans.find((x)=>x.id==='$sid');let off=0;for(const s of plan.spans){if(s.id==='$sid')break;off+=s.out-s.in}console.log($i==1?0:(plan.titleSeconds+off+($a-sp.in)).toFixed(2))})")
  bgm_dur=$(node -e "import('./build/plan.mjs').then(({plan})=>console.log((($i==1?plan.titleSeconds:0)+$dur+($i==$N?plan.tailSeconds:0)).toFixed(2)))")
  ffmpeg -v error -y -ss "$bgm_from" -t "$bgm_dur" -i assets/bgm/track.wav -ar 48000 -ac 1 "assets/bgm/part$i.wav"
  node build/build.mjs --clip="$piece" --out="build/html/part$i.html" --audio="assets/audio/part$i.wav" --bgm="assets/bgm/part$i.wav" | head -1
  if [ "${PREP:-0}" = "1" ]; then
    echo "   (仅准备，跳过渲染)"
    continue
  fi
  HF_DE_STALL_MS=900000 HF_DE_FRAME_TIMEOUT_MS=600000 \
  PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED=false \
  HYPERFRAMES_BROWSER_PATH="$CHROME" \
  npx -y "$HF_BIN" render . -c "build/html/part$i.html" --workers 1 --protocol-timeout 900000 \
    -o "$target" -f 30 < /dev/null > "/tmp/part$i.log" 2>&1; tail -3 "/tmp/part$i.log"
done

echo "== 拼接"
OUT_FILM="${OUT_FILM:-../$(basename "$PWD")-PC版.mp4}"   # 交付时改成 "第N集-<主题>-…mp4"
: > "$OUT_DIR/list-$TAG.txt"
for i in $(seq 1 "$N"); do echo "file '$TAG-p$i.mp4'" >> "$OUT_DIR/list-$TAG.txt"; done
ffmpeg -v error -y -f concat -safe 0 -i "$OUT_DIR/list-$TAG.txt" -c:v copy -c:a aac -b:a 160k "$OUT_FILM"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT_FILM"
