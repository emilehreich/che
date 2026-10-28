#!/usr/bin/env python3
"""Tiny stand-in for the Anthropic Messages API, for end-to-end tests.

Claude Code (pointed here with ANTHROPIC_BASE_URL) asks it for the main
conversation and the plugin asks it for card text. Control files live in
MOCK_DIR (default $E2E_DIR/mock, see setup.sh):

  cmd.txt             what the agent does next: a shell command, or
                      EDIT:<path>, WRITE:<path>, FETCH:<url>, MCP:<tool name>
  story               if present: read a file, run `git status`, then cmd.txt
  explain_reply.txt   the reply to the plugin's command-card request
  edit_reply.txt      the reply to the plugin's edit-card request
  edit_fail           if present: the edit-card request fails with HTTP 500
  edit_prompt.txt     written: the last edit-card request, to inspect
  api.log             written: every request

Supports streaming (SSE) and non-streaming replies.
"""
import json
import os
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MOCK_DIR = os.environ.get("MOCK_DIR") or os.path.join(
    os.environ.get("E2E_DIR") or os.path.join(os.environ.get("TMPDIR", "/tmp"), "eba-e2e"), "mock")
os.makedirs(MOCK_DIR, exist_ok=True)


def mock(name):
    return os.path.join(MOCK_DIR, name)


def _cmd():
    try:
        return open(mock("cmd.txt")).read().strip() or COMMAND
    except OSError:
        return COMMAND


COMMAND = os.environ.get("MOCK_COMMAND", "ps aux | grep -i node | head -5")
DESCRIPTION = os.environ.get("MOCK_DESCRIPTION", "Check which node processes are running")
LOG = os.environ.get("MOCK_LOG") or mock("api.log")


def log(msg):
    with open(LOG, "a") as fh:
        fh.write(msg + "\n")


def has_tool_result(messages):
    for m in messages:
        c = m.get("content")
        if isinstance(c, list) and any(isinstance(b, dict) and b.get("type") == "tool_result"
                                       for b in c):
            return True
    return False


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        log("GET " + self.path)
        body = json.dumps({"data": [], "has_more": False}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(n)
        try:
            req = json.loads(raw or b"{}")
        except ValueError:
            req = {}
        tools = [t.get("name") for t in req.get("tools") or [] if isinstance(t, dict)]
        msgs = req.get("messages") or []
        log("POST %s model=%s tools=%d stream=%s tool_result=%s" % (
            self.path, req.get("model"), len(tools), req.get("stream"), has_tool_result(msgs)))
        if not tools:
            log("  system: " + json.dumps(req.get("system", ""))[:400].replace("\\n", " "))
            log("  last msg: " + json.dumps(msgs[-1] if msgs else {})[:400])
        if "count_tokens" in self.path:
            return self.json({"input_tokens": 100})
        system = json.dumps(req.get("system", ""))
        if "You explain code edits to a developer" in system:
            with open(mock("edit_prompt.txt"), "w") as fh:
                fh.write(system + "\n=====\n" + json.dumps(msgs, indent=1))
            log("  -> edit explainer request")
            if os.path.exists(mock("edit_fail")):
                body = json.dumps({"type": "error", "error": {"type": "api_error", "message": "mock failure"}}).encode()
                self.send_response(500); self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)
                return
            import time as _t; _t.sleep(float(os.environ.get("MOCK_EDIT_DELAY", "1.5")))
            text = open(mock("edit_reply.txt")).read() if os.path.exists(mock("edit_reply.txt")) else (
                "FILE: Token helpers the login flow uses to decide whether a session token is still valid\n"
                "CHANGE: isExpired now treats a token with no expiry as expired, and counts a token as expired slightly early to allow for clock drift.\n"
                "WHY: Fixes the failing login test you asked about: tokens without an expiry were accepted forever.\n"
                "PSEUDO: = function isExpired(exp, now):\n"
                "PSEUDO: +   if the token has no expiry (exp is missing):\n"
                "PSEUDO: +     report it as expired\n"
                "PSEUDO: -   expired only when exp is before now\n"
                "PSEUDO: ~   expired when exp is at or before now minus CLOCK_SKEW_MS\n"
                "WATCH: CLOCK_SKEW_MS is used but not defined or imported in this file\n"

                "WATCH: < became <=: a token expiring exactly now is now treated as expired\n"
                "RISK: MEDIUM")
            blocks = [{"type": "text", "text": text}]
            if req.get("stream"):
                return self.stream(req, blocks, "end_turn")
            return self.json({"id": "msg_e", "type": "message", "role": "assistant",
                              "model": req.get("model", "mock"), "content": blocks,
                              "stop_reason": "end_turn", "stop_sequence": None,
                              "usage": {"input_tokens": 10, "output_tokens": 10}})
        if "review the actions an AI coding agent" in system:
            log("  -> explainer request; prompt starts: " + json.dumps(msgs[-1])[:300])
            blocks = [{"type": "text", "text": open(mock("explain_reply.txt")).read() if os.path.exists(mock("explain_reply.txt")) else (
                "WHY: Rebuilds from scratch to check whether the stale build output is what makes the login test fail.\n"
                "PART: verify - confirms the token-expiry fix for the failing login test you asked about\n"
                "DOES: Deletes the build folder, reinstalls the exact locked dependencies, rebuilds and shows the last 20 log lines.\n"
                "STEP 1: delete the old build output, no confirmation\n"
                "STEP 2: only if that worked: clean-install the exact versions from package-lock.json\n"
                "STEP 3: only if that worked: rebuild, sending errors (2>&1) along with the normal output\n"
                "STEP 4: keep only the last 20 lines of the build output\n"
                "EFFECTS: deletes build/, rewrites node_modules/, runs package install scripts\nMISMATCH: none\nRISK: MEDIUM")}]
            stop = "end_turn"
            if req.get("stream"):
                return self.stream(req, blocks, stop)
            return self.json({"id": "msg_x", "type": "message", "role": "assistant",
                              "model": req.get("model", "mock"), "content": blocks,
                              "stop_reason": stop, "stop_sequence": None,
                              "usage": {"input_tokens": 10, "output_tokens": 10}})
        n_results = sum(1 for m in msgs if isinstance(m.get("content"), list) and any(
            isinstance(b, dict) and b.get("type") == "tool_result" for b in m["content"]))
        if os.path.exists(mock("story")) and "Bash" in tools and n_results < 3:
            tid = "toolu_" + uuid.uuid4().hex[:20]
            story = [
                ("Let me look at how the login test checks token expiry.",
                 {"name": "Read", "input": {"file_path": os.path.join(os.environ.get("E2E_PROJECT", "."), "package.json")}}),
                ("The test reads a cached build. Checking what's changed.",
                 {"name": "Bash", "input": {"command": "git status --short", "description": "Show changed files"}}),
                ("The build output is stale, so I'll rebuild from scratch and re-run.",
                 {"name": "Bash", "input": {"command": _cmd(), "description": "Clean rebuild"}}),
            ][n_results]
            blocks = [{"type": "text", "text": story[0]},
                      dict({"type": "tool_use", "id": tid}, **story[1])]
            if req.get("stream"):
                return self.stream(req, blocks, "tool_use")
            return self.json({"id": "msg_s", "type": "message", "role": "assistant",
                              "model": req.get("model"), "content": blocks, "stop_reason": "tool_use",
                              "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1}})
        if ("Bash" in tools or "WebFetch" in tools) and not has_tool_result(msgs):
            c = _cmd()
            if c.startswith("FETCH:"):
                use = {"type": "tool_use", "id": "toolu_" + uuid.uuid4().hex[:20], "name": "WebFetch",
                       "input": {"url": c[6:], "prompt": "Summarize the install steps"}}
            elif c.startswith("MCP:"):
                use = {"type": "tool_use", "id": "toolu_" + uuid.uuid4().hex[:20], "name": c[4:],
                       "input": {"id": "T-1234"}}
            elif c.startswith("EDIT:"):
                use = {"type": "tool_use", "id": "toolu_" + uuid.uuid4().hex[:20], "name": "Edit",
                       "input": {"file_path": c[5:], "old_string": "  return exp < now;",
                                 "new_string": "  if (exp == null) {\n    return true;\n  }\n  return exp <= now - CLOCK_SKEW_MS;"}}
            elif c.startswith("WRITE:"):
                path = c[6:]
                use = {"type": "tool_use", "id": "toolu_" + uuid.uuid4().hex[:20], "name": "Write",
                       "input": {"file_path": path, "content": "export const retries = 3;\n"}}
            else:
                use = {"type": "tool_use", "id": "toolu_" + uuid.uuid4().hex[:20], "name": "Bash",
                       "input": {"command": c, "description": DESCRIPTION}}
            say = ("The expiry check accepts tokens without an expiry; I'll make it reject them and allow for clock skew."
                   if use["name"] in ("Edit", "Write") else "I'll check the running node processes.")
            blocks = [{"type": "text", "text": say}, use]
            stop = "tool_use"
        else:
            blocks = [{"type": "text", "text": "Done."}]
            stop = "end_turn"
        if req.get("stream"):
            return self.stream(req, blocks, stop)
        return self.json({"id": "msg_" + uuid.uuid4().hex[:20], "type": "message",
                          "role": "assistant", "model": req.get("model", "mock"),
                          "content": blocks, "stop_reason": stop, "stop_sequence": None,
                          "usage": {"input_tokens": 10, "output_tokens": 10}})

    def json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def stream(self, req, blocks, stop):
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.end_headers()

        def ev(name, data):
            self.wfile.write(("event: %s\ndata: %s\n\n" % (name, json.dumps(data))).encode())
            self.wfile.flush()

        ev("message_start", {"type": "message_start", "message": {
            "id": "msg_" + uuid.uuid4().hex[:20], "type": "message", "role": "assistant",
            "model": req.get("model", "mock"), "content": [], "stop_reason": None,
            "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1}}})
        for i, b in enumerate(blocks):
            if b["type"] == "text":
                ev("content_block_start", {"type": "content_block_start", "index": i,
                                           "content_block": {"type": "text", "text": ""}})
                ev("content_block_delta", {"type": "content_block_delta", "index": i,
                                           "delta": {"type": "text_delta", "text": b["text"]}})
            else:
                ev("content_block_start", {"type": "content_block_start", "index": i,
                                           "content_block": {"type": "tool_use", "id": b["id"],
                                                             "name": b["name"], "input": {}}})
                ev("content_block_delta", {"type": "content_block_delta", "index": i,
                                           "delta": {"type": "input_json_delta",
                                                     "partial_json": json.dumps(b["input"])}})
            ev("content_block_stop", {"type": "content_block_stop", "index": i})
        ev("message_delta", {"type": "message_delta",
                             "delta": {"stop_reason": stop, "stop_sequence": None},
                             "usage": {"output_tokens": 20}})
        ev("message_stop", {"type": "message_stop"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
