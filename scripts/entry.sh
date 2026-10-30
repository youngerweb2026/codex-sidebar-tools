#!/bin/bash
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTION="$1"
shift
NODE_BIN=""
for CANDIDATE in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node /Applications/Codex.app/Contents/Resources/cua_node/bin/node /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node; do
  if [ -x "$CANDIDATE" ] && "$CANDIDATE" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' >/dev/null 2>&1; then
    NODE_BIN="$CANDIDATE"
    break
  fi
done
if [ -z "$NODE_BIN" ]; then
  echo '需要 Node.js 24 或更新版本，请先安装 Node.js。'
  exit 1
fi
"$NODE_BIN" "$SCRIPT_DIR/../manage.cjs" "$ACTION" "$@"
RESULT=$?
if [ "$RESULT" -ne 0 ] && [ -t 0 ]; then
  read -r -p '按回车关闭窗口…' _
fi
exit "$RESULT"
