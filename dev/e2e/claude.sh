#!/bin/bash
# Run Claude Code in the sandbox against the mock API, nothing inherited from
# your own environment: claude.sh [claude args...]
source "$(dirname "$0")/env.sh"
cd "$E2E_PROJECT"
exec env -i HOME="$E2E_HOME" PATH="$PATH" TERM="${TERM:-xterm-256color}" LANG="${LANG:-C.UTF-8}" \
  CLAUDE_CONFIG_DIR="$E2E_CONFIG" ANTHROPIC_BASE_URL="http://127.0.0.1:$E2E_PORT" \
  ANTHROPIC_API_KEY=sk-ant-api03-e2etestkey0000000000000000000000000000 \
  NO_PROXY=127.0.0.1,localhost E2E_DIR="$E2E_DIR" E2E_PROJECT="$E2E_PROJECT" MOCK_DIR="$MOCK_DIR" \
  claude "$@"
