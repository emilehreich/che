#!/bin/bash
# Create a throwaway Claude Code sandbox: its own HOME, config dir and demo
# project, onboarding done, the project trusted, the mock API key approved.
# Then start the mock Messages API in the background.
set -e
source "$(dirname "$0")/env.sh"
mkdir -p "$E2E_HOME" "$E2E_CONFIG" "$E2E_PROJECT/src" "$MOCK_DIR" "$E2E_DIR/shots"
cat > "$E2E_CONFIG/.claude.json" <<JSON
{"hasCompletedOnboarding": true,
 "customApiKeyResponses": {"approved": ["00000000000000000000"], "rejected": []},
 "projects": {"$E2E_PROJECT": {"hasTrustDialogAccepted": true, "allowedTools": []}}}
JSON
echo '{}' > "$E2E_CONFIG/settings.json"
cd "$E2E_PROJECT"
[ -f package.json ] || echo '{"name":"demo","version":"1.0.0","scripts":{"test":"echo ok","build":"echo built"}}' > package.json
[ -f src/auth.ts ] || printf 'export function isExpired(exp, now) {\n  return exp < now;\n}\n' > src/auth.ts
[ -d .git ] || (git init -q && git add -A && git -c user.name=e2e -c user.email=e2e@example.com commit -qm init)
if ! curl -s "http://127.0.0.1:$E2E_PORT/" >/dev/null 2>&1; then
  nohup python3 "$HERE/mock_api.py" "$E2E_PORT" > "$MOCK_DIR/server.log" 2>&1 &
  sleep 1
fi
echo "sandbox: $E2E_DIR   mock API: http://127.0.0.1:$E2E_PORT   plugin: $PLUGIN"
