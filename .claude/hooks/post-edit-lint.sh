#!/usr/bin/env bash
# PostToolUse hook (Write|Edit): eslint --fix the just-edited file.
# Mirrors the lint-staged pattern in package.json (*.{ts,tsx,astro}).
set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

[[ -z "$file_path" ]] && exit 0

case "$file_path" in
  *.ts | *.tsx | *.astro) ;;
  *) exit 0 ;;
esac

[[ -f "$file_path" ]] || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}"

if ! output=$(./node_modules/.bin/eslint --fix "$file_path" 2>&1); then
  echo "$output"
  exit 2
fi

exit 0
