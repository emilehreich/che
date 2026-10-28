# Sourced by the other scripts: where the sandbox lives.
E2E_DIR="${E2E_DIR:-${TMPDIR:-/tmp}/eba-e2e}"
E2E_DIR="${E2E_DIR%/}"
E2E_HOME="$E2E_DIR/home"
E2E_CONFIG="$E2E_DIR/config"
E2E_PROJECT="$E2E_DIR/project"
E2E_PORT="${E2E_PORT:-8765}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$(cd "$HERE/../../plugins/che" && pwd)"
export E2E_DIR E2E_PROJECT
export MOCK_DIR="$E2E_DIR/mock"
