#!/bin/bash
# 在局域网里起一个静态服务器，方便平板访问
set -e
cd "$(dirname "$0")"
PORT="${1:-8080}"

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "你的局域网IP")

echo ""
echo "  ┌──────────────────────────────────────────────┐"
echo "  │  追上去！· 追及问题实验室                    │"
echo "  └──────────────────────────────────────────────┘"
echo ""
echo "  电脑上打开:   http://127.0.0.1:$PORT"
echo "  平板上打开:   http://$IP:$PORT"
echo ""
echo "  （平板和电脑要连同一个 Wi-Fi，横屏使用）"
echo "  按 Ctrl+C 停止"
echo ""
python3 -m http.server "$PORT" --bind 0.0.0.0
