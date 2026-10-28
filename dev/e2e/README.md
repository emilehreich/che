# End-to-end harness

Runs the real Claude Code in a pseudo-terminal against a mock Messages API,
with the plugin loaded, and saves what the screen shows. No login, no network,
nothing from your own Claude Code setup: the sandbox has its own HOME and
config directory.

```bash
dev/e2e/setup.sh                                    # sandbox + mock API (port 8765)
echo 'rm -rf build && npm ci && npm run build 2>&1 | tail -20' > "${TMPDIR:-/tmp}/eba-e2e/mock/cmd.txt"
dev/e2e/shot.sh 104x60 rebuild classic "This step" "the build is stale, rebuild it"
```

`shot.sh` waits until the given text is on screen (and the screen has been
still for 1.5 s), saves it to `$E2E_DIR/shots/<name>.final.txt`, prints it and
quits Claude Code. Use `fullscreen` instead of `classic` for Claude Code's
fullscreen renderer.

What the mock does is driven by files in `$E2E_DIR/mock/` (see the top of
`mock_api.py`):

| File | Effect |
| --- | --- |
| `cmd.txt` | The step the agent asks to take: a shell command, or `EDIT:<path>`, `WRITE:<path>`, `FETCH:<url>`, `MCP:<tool>` |
| `story` | If present, the agent first reads a file and runs `git status`, so the card has a "So far" trail |
| `explain_reply.txt` | What the "model" answers the command-card request with (labelled lines: `WHY:`, `PART:`, `DOES:`, `STEP <n>:`, `EFFECTS:`, `MISMATCH:`, `RISK:`) |
| `edit_reply.txt` | What it answers the edit-card request with (`FILE:`, `CHANGE:`, `WHY:`, `PSEUDO:`, `WATCH:`, `RISK:`) |
| `edit_fail` | If present, the edit-card request fails, to see the offline card |
| `edit_prompt.txt` | Written: the last edit-card prompt the plugin sent, to check what the model gets |
| `api.log` | Written: every request |

Variables: `E2E_DIR` (default `$TMPDIR/eba-e2e`), `E2E_PORT` (default 8765),
`TUI_TOTAL` (seconds before `shot.sh` gives up, default 60).
`claude.sh` runs Claude Code in the sandbox by hand, e.g.
`dev/e2e/claude.sh --plugin-dir plugins/che`.
