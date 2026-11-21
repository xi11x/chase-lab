#!/bin/bash
# 把 src/ 下的三份源码合成单文件 index.html
set -e
cd "$(dirname "$0")"

OUT="index.html"
{
cat <<'HEAD'
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#bfe2ff">
<title>追上去！· 追及问题实验室</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='88'%3E%F0%9F%8F%83%3C/text%3E%3C/svg%3E">
<style>
HEAD
cat src/style.css
cat <<'MID'
</style>
</head>
<body>
MID
cat src/body.html
cat <<'MID2'
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
  }
}
</script>
<script type="module">
MID2
cat src/game.js
cat <<'TAIL'
</script>
<script>
  // 加载兜底提示
  setTimeout(function () {
    if (!window.__booted) {
      var t = document.getElementById('loadTxt');
      if (t && !t.dataset.warned) { t.dataset.warned = '1'; t.textContent = '加载有点慢…请检查网络后刷新'; }
    }
  }, 12000);
</script>
</body>
</html>
TAIL
} > "$OUT"

echo "built: $(pwd)/$OUT  ($(wc -c < "$OUT") bytes, $(wc -l < "$OUT") lines)"
