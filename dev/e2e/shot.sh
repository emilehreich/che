#!/bin/bash
# Screenshot Claude Code's terminal once a text appears, with the plugin loaded:
#   shot.sh COLSxROWS NAME classic|fullscreen "TEXT TO WAIT FOR" "prompt"
# Writes $E2E_DIR/shots/NAME.final.txt (the screen) and NAME.raw (the bytes).
# TEXT TO WAIT FOR may instead be a full step list: "wait::keys::label||...".
source "$(dirname "$0")/env.sh"
size=$1; name=$2; rend=$3; wait=$4; prompt=$5; shift 5; [ "$1" = "--" ] && shift
c=${size%x*}; r=${size#*x}
REND=$rend CFG="$E2E_CONFIG/.claude.json" python3 - <<'PY'
import json, os
p = os.environ["CFG"]; d = json.load(open(p))
for k in list(d):
    if "boot" in k.lower(): d.pop(k)
if os.environ["REND"] == "fullscreen": d["tui"] = "fullscreen"
else: d.pop("tui", None)
json.dump(d, open(p, "w"))
PY
case "$wait" in *::*) steps="$wait" ;; *) steps="$wait::::shot" ;; esac
TUI_COLS=$c TUI_ROWS=$r TUI_TOTAL=${TUI_TOTAL:-60} TUI_STEPS="$steps" \
  python3 "$HERE/tui.py" "$E2E_DIR/shots/$name" -- "$HERE/claude.sh" "$prompt" \
  --permission-mode default --plugin-dir "$PLUGIN" "$@" > /dev/null 2>&1
cat "$E2E_DIR/shots/$name.final.txt"
