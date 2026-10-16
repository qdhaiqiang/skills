#!/usr/bin/env bash
# 渲染前把 Chrome 探针"预热"到秒级：macOS 上 syspolicyd 会周期性重新核验应用签名，
# 此时 `Chrome --version` 能慢到 5–6s，HyperFrames 的浏览器探测因此超时报 "Chrome cannot start"。
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for i in 1 2 3 4 5 6 7 8 9 10; do
  start=$(python3 -c 'import time;print(time.time())' 2>/dev/null || date +%s)
  "$CHROME" --version >/dev/null 2>&1
  end=$(python3 -c 'import time;print(time.time())' 2>/dev/null || date +%s)
  el=$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.2f", b-a}')
  echo "try$i ${el}s"
  awk -v x="$el" 'BEGIN{exit !(x<1.2)}' && { echo "探针已就绪"; exit 0; }
  sleep 3
done
echo "探针仍然偏慢，继续等待后重试"
exit 1
