#!/bin/zsh
cd -- "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  aqua_node="$(command -v node)"
else
  aqua_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$aqua_node" ]]; then
  print 'Node.js was not found. Install Node.js 22 or newer, then launch again.'
  read '?Press Enter to close.'
  exit 1
fi
if ! "$aqua_node" -e "require('ws')" >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    npm install --omit=dev || exit 1
  else
    aqua_pnpm="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm"
    if [[ ! -x "$aqua_pnpm" ]]; then
      print 'Dependencies are missing. Install Node.js with npm, then try again.'
      read '?Press Enter to close.'
      exit 1
    fi
    "$aqua_pnpm" install --frozen-lockfile || exit 1
  fi
fi
"$aqua_node" launcher.cjs
aqua_exit_code=$?
if [[ "$aqua_exit_code" -ne 0 ]]; then
  read '?Press Enter to close.'
fi
exit "$aqua_exit_code"
