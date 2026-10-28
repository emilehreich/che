// Tests for hooks/cards.js. Run: node tests/test_cards.mjs
//
// The module runs inside Claude Code; here a fake engine stands in: `on`
// collects the hooks, `$` serves files, the transcript and a canned model
// reply, and Box/Text build plain trees that the tests read back as text.

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, "..", "hooks", "cards.js"), "utf8")
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eba-"))
const modPath = path.join(tmp, "mod.mjs")
fs.writeFileSync(modPath, src + "\nexport { parseReply, diffLines, showDiff, describeEdit, offlineOutline, buildPrompt, drawEditCard, drawActionCard, parseActionReply, splitPart, staticRisk }\n")
const M = await import(pathToFileURL(modPath).href)

const REPLY = `FILE: Token helpers the login flow uses
CHANGE: isExpired now treats a missing expiry as expired and allows for clock drift.
WHY: Fixes the failing login test.
PSEUDO: = function isExpired(exp, now):
PSEUDO: +   if exp is missing:
PSEUDO: +     report expired
PSEUDO: -   expired only when exp is before now
PSEUDO: ~   expired when exp is at or before now minus CLOCK_SKEW_MS
WATCH: CLOCK_SKEW_MS is not defined in this file
WATCH: none
RISK: MEDIUM`

// --- a fake engine --------------------------------------------------------

const el = {
  Box: (p) => ({ t: "Box", p, kids: p.children || [] }),
  Text: (p) => ({ t: "Text", p, kids: p.children || [] }),
  Markdown: (p) => ({ t: "Markdown", p, kids: [p.text] }),
  Code: (p) => ({ t: "Code", p, kids: [p.source] }),
}
const TERM = { surface: "terminal", viewport: { columns: 100, rows: 40 } }
const PANEL = { surface: "vscode", viewport: { columns: 90, rows: 40 } }
function findAll(node, pred, out = []) {
  if (!node || typeof node === "string") return out
  if (pred(node)) out.push(node)
  node.kids.forEach((k) => findAll(k, pred, out))
  return out
}
function textOf(node) {
  if (typeof node === "string") return node
  if (!node) return ""
  const inner = node.kids.map(textOf)
  return node.t === "Box" && node.p.flexDirection !== "row" ? inner.join("\n") : inner.join("")
}

function engine({ files = {}, reply = REPLY, answered = true, messages = [], data = null } = {}) {
  const hooks = {}
  const calls = { model: [], invalidate: 0, logs: [], runs: [] }
  const on = (name, a, b) => { hooks[name + (b && a?.component ? ":" + a.component : "")] = b || a }
  const $ = {
    plugin: { root: "/plug", name: "che" },
    process: { run: async (argv, init) => { calls.runs.push({ argv, stdin: init?.stdin })
      if (!data) throw new Error("ENOENT"); return { exitCode: 0, stdout: JSON.stringify(data), stderr: "" } } },
    fs: { read: async (p) => { if (p in files) return files[p]; throw new Error("ENOENT") } },
    session: { root: async () => "/proj", id: async () => "s1", messages: async () => messages },
    model: { complete: async (req) => { calls.model.push(req); return answered ? { isAnswered: true, text: reply } : { isAnswered: false, reason: "api-error", status: 500 } } },
    ui: { invalidate: () => { calls.invalidate++ }, log: (t) => calls.logs.push(t), resolve: () => el },
  }
  return { hooks, calls, $, on }
}
const settle = () => new Promise((r) => setTimeout(r, 20))

let failed = 0, passed = 0
async function test(name, fn) {
  try { await fn(); passed++; console.log("ok   " + name) }
  catch (err) { failed++; console.log("FAIL " + name + "\n     " + (err.stack || err).split("\n").slice(0, 4).join("\n     ")) }
}

// --- pure parts -----------------------------------------------------------

await test("parseReply reads labels, markers, nesting and risk", () => {
  const r = M.parseReply(REPLY)
  assert.equal(r.file, "Token helpers the login flow uses")
  assert.equal(r.risk, 1)
  assert.deepEqual(r.pseudo.map((p) => [p.mark, p.indent]), [["=", 0], ["+", 1], ["+", 2], ["-", 1], ["~", 1]])
  assert.equal(r.pseudo[1].text, "if exp is missing:")
  assert.deepEqual(r.watch, ["CLOCK_SKEW_MS is not defined in this file"])     // "none" dropped
  assert.equal(M.parseReply("Sorry, I can't help."), null)
})

await test("diff counts and new-file line numbers", () => {
  const ops = M.diffLines(["a", "b", "c"], ["a", "x", "y", "c"])
  const d = M.showDiff(ops, 10)
  assert.deepEqual([d.added, d.removed, d.first, d.last], [2, 1, 11, 12])
  assert.match(d.text, /^ {3}11 \+ x$/m)
})

await test("describeEdit locates the snippet and reads context", async () => {
  const { $ } = engine({ files: { "/proj/src/auth.ts": "import x\n\nexport function isExpired(exp, now) {\n  return exp < now;\n}\n" } })
  const info = await M.describeEdit($, "Edit", { file_path: "/proj/src/auth.ts", old_string: "  return exp < now;",
                                                  new_string: "  if (exp == null) return true;\n  return exp <= now;" }, "/proj")
  assert.equal(info.rel, "src/auth.ts")
  assert.equal(info.lang, "TypeScript")
  assert.deepEqual([info.added, info.removed, info.first, info.last, info.totalLines], [2, 1, 4, 5, 5])
  assert.match(info.whole, /4 {2} {2}return exp < now;/)
})

await test("describeEdit for new and overwritten files", async () => {
  const { $ } = engine({ files: { "/proj/a.py": "x = 1\ny = 2\n" } })
  const created = await M.describeEdit($, "Write", { file_path: "/proj/new.py", content: "a = 1\nb = 2\n" }, "/proj")
  assert.deepEqual([created.isNew, created.kind, created.added, created.removed], [true, "create a new file", 2, 0])
  const over = await M.describeEdit($, "Write", { file_path: "/proj/a.py", content: "x = 1\ny = 3\n" }, "/proj")
  assert.deepEqual([over.kind, over.added, over.removed], ["overwrite the whole file", 1, 1])
})

await test("prompt carries request, narration, file and diff, marked untrusted", async () => {
  const { $ } = engine({ files: { "/proj/src/auth.ts": "export function isExpired(exp, now) {\n  return exp < now;\n}\n" } })
  const info = await M.describeEdit($, "Edit", { file_path: "/proj/src/auth.ts", old_string: "exp < now", new_string: "exp <= now" }, "/proj")
  const p = M.buildPrompt(info, { goal: "fix the login test", narration: "I'll fix the comparison." }, "French")
  assert.match(p, /^<data>/)
  assert.match(p, /User's request: fix the login test/)
  assert.match(p, /said just before this edit: I'll fix the comparison\./)
  assert.match(p, /^ +2 \+ exp <= now$/m)
  assert.match(p, /Reply in French/)
})

await test("offline outline names what the added lines define", () => {
  const out = M.offlineOutline({ addedLines: ["export async function retry(fn) {", "  const delay = 5", "def parse(x):", "class Cache {"] })
  assert.deepEqual(out.map((o) => o.text), ["defines retry", "defines delay", "defines parse", "defines Cache"])
})

await test("static risk flags secrets, CI and files outside the project", () => {
  const flags = (p) => M.staticRisk({ path: p }, "/proj").map(([l]) => l)
  assert.deepEqual(flags("/proj/src/a.ts"), [])
  assert.deepEqual(flags("/proj/.env"), [2])
  assert.deepEqual(flags("/proj/.github/workflows/ci.yml"), [1])
  assert.deepEqual(flags("/etc/hosts"), [2])
})

// --- the card ------------------------------------------------------------

function sampleCard(reply = M.parseReply(REPLY)) {
  return { state: "ready", reply, flags: [], offline: "", fallback: "replace one snippet: +4 −1",
           info: { first: 2, last: 5, added: 4, removed: 1, rel: "src/auth.ts" } }
}

await test("card shows every part with room to spare", () => {
  const t = textOf(M.drawEditCard(el, sampleCard(), TERM))
  for (const s of ["In plain English", "Medium risk", "Lines 2–5", "+4", "−1", "File", "Change", "Why",
                   "Logic", "+ new", "~ changed", "− removed", "if exp is missing:", "report expired",
                   "Watch", "CLOCK_SKEW_MS is not defined"])
    assert.ok(t.includes(s), s + "\n" + t)
  assert.ok(!t.includes("…"), t)
})

// --- the hooks, end to end ----------------------------------------------

const FILES = { "/proj/src/auth.ts": "export function isExpired(exp, now) {\n  return exp < now;\n}\n" }
const EDIT = { file_path: "/proj/src/auth.ts", old_string: "  return exp < now;", new_string: "  return exp <= now;" }

async function flow(opts = {}, options = {}) {
  const eng = engine({ files: FILES, messages: [
    { role: "user", text: "the login test fails, fix it", toolUses: [] },
    { role: "assistant", text: "I'll tighten the comparison.", toolUses: [{ tool_use_id: "t1", tool: "Edit", input: EDIT }] },
  ], ...opts })
  M.drawCard  // keep the import live
  const mod = await import(pathToFileURL(modPath).href)
  mod.register(eng.on, options)
  const h = eng.hooks
  const render = async () => textOf(await h["ui.render:ToolUse"](eng.$, { props: { tool_use_id: "t1" }, viewport: { columns: 100, rows: 50 } },
                                                          async () => "● Update(src/auth.ts)"))
  return { ...eng, h, render }
}

await test("no prompt, no card: auto-approved edits are left alone", async () => {
  const f = await flow()
  await f.h["tool.check"](f.$, { tool: "Edit", input: EDIT, tool_use_id: "t1" }, async () => ({ decision: "allow" }))
  await f.h["classic.PermissionRequest"](f.$, { tool_name: "Edit", tool_input: EDIT }, async () => ({}))
  await settle()
  assert.equal(f.calls.model.length, 0)
  assert.equal(await f.render(), "● Update(src/auth.ts)")
})

await test("prompt opens: placeholder, then the card, then a summary line", async () => {
  const f = await flow()
  await f.h["tool.check"](f.$, { tool: "Edit", input: EDIT, tool_use_id: "t1" }, async () => ({ decision: "ask" }))
  const p = f.h["classic.PermissionRequest"](f.$, { tool_name: "Edit", tool_input: JSON.parse(JSON.stringify(EDIT)) }, async () => "passed")
  assert.equal(await p, "passed")                               // the classic chain still runs
  await settle()
  assert.equal(f.calls.model.length, 1)
  assert.equal(f.calls.model[0].model, "haiku")
  assert.match(f.calls.model[0].prompt, /the login test fails, fix it/)
  assert.match(f.calls.model[0].prompt, /I'll tighten the comparison\./)
  const card = await f.render()
  assert.match(card, /^● Update\(src\/auth\.ts\)\n/)
  assert.match(card, /In plain English/)
  await f.h["tool.call"](f.$, { tool: "Edit", input: EDIT, tool_use_id: "t1" }, async () => ({ result: "ok" }))
  assert.equal(await f.render(), "● Update(src/auth.ts)\nplain English: isExpired now treats a missing expiry as expired and allows for clock drift.")
})

await test("model failure: offline card with what is known", async () => {
  const f = await flow({ answered: false })
  await f.h["tool.check"](f.$, { tool: "Edit", input: EDIT, tool_use_id: "t1" }, async () => ({ decision: "ask" }))
  await f.h["classic.PermissionRequest"](f.$, { tool_name: "Edit", tool_input: EDIT }, async () => ({}))
  await settle()
  const card = await f.render()
  assert.match(card, /offline card/)
  assert.match(card, /model call failed \(api-error 500\)/)
  assert.match(card, /Claude says: I'll tighten the comparison\./)
})

await test("options: backend=local never calls the model; explain_edits=false registers nothing", async () => {
  const f = await flow({}, { backend: "local" })
  await f.h["tool.check"](f.$, { tool: "Edit", input: EDIT, tool_use_id: "t1" }, async () => ({ decision: "ask" }))
  await f.h["classic.PermissionRequest"](f.$, { tool_name: "Edit", tool_input: EDIT }, async () => ({}))
  await settle()
  assert.equal(f.calls.model.length, 0)
  assert.match(await f.render(), /Offline: backend=local/)
  const off = await flow({}, { explain_edits: false })
  await off.h["tool.check"](off.$, { tool: "Edit", input: EDIT, tool_use_id: "t1" }, async () => ({ decision: "ask" }))
  await off.h["classic.PermissionRequest"](off.$, { tool_name: "Edit", tool_input: EDIT }, async () => ({}))
  await settle()
  assert.equal(off.calls.model.length, 0)
  assert.equal(await off.render(), "● Update(src/auth.ts)")
})

// --- action cards (shell, web, connectors) ----------------------------------

const DATA = {
  family: "shell", risks: [[2, "recursively deletes build without confirmation"]], does: "2 commands",
  steps: [{ text: "for b in a b", op: "$", depth: 0, closer: false, fallback: "loop" },
          { text: "do rm -rf build/$b", op: "$", depth: 1, closer: false, fallback: "delete files" },
          { text: "done", op: "", depth: 0, closer: true, fallback: "" },
          { text: "npm ci", op: "&&", depth: 0, closer: false, fallback: "clean-install" }],
  stated: "Claude says: Clean rebuild", todo: "Fix expiry (1/3 done)",
  trail: [{ label: "read package.json", done: true, error: false }, { label: "ran tests", done: false, error: true }],
  earlier: 0, system: "SYS", prompt: "PROMPT",
}
const ACTION_REPLY = `WHY: Rebuilds from scratch to rule out a stale build.
PART: verify - checks the token fix
DOES: Deletes two build folders, then reinstalls dependencies.
STEP 1: repeat part 2 for a and b
STEP 2: delete that build folder
STEP 3: only if the deletes worked: reinstall the locked dependencies
EFFECTS: deletes build/a and build/b, rewrites node_modules
MISMATCH: none
RISK: MEDIUM`
const CMD = { command: "for b in a b; do rm -rf build/$b; done && npm ci", description: "Clean rebuild" }

await test("action reply: labels, numbered steps, risk", () => {
  const r = M.parseActionReply(ACTION_REPLY)
  assert.equal(r.why, "Rebuilds from scratch to rule out a stale build.")
  assert.deepEqual(r.steps, { 1: "repeat part 2 for a and b", 2: "delete that build folder",
                              3: "only if the deletes worked: reinstall the locked dependencies" })
  assert.equal(r.risk, 1)
  assert.deepEqual(M.splitPart(r.part), ["VERIFY", "checks the token fix"])
})

await test("action card: every part verbatim with its meaning, nothing cut", () => {
  const t = textOf(M.drawActionCard(el, { data: DATA, reply: M.parseActionReply(ACTION_REPLY), offline: "" }, TERM))
  for (const s of ["Before you approve", "High risk", "Verify", "To-do: Fix expiry (1/3 done)", "Why",
                   "Rebuilds from scratch to rule out a stale build.", "Part", "Checks the token fix",
                   "1.", "for b in a b", "repeat part 2 for a and b", "2.", "do rm -rf build/$b",
                   "delete that build folder", "done", "3.", "&&", "npm ci", "reinstall the locked dependencies",
                   "Effects", "Watch", "Recursively deletes build without confirmation",
                   "So far", "✓ Read package.json", "✗ Ran tests", "This step"])
    assert.ok(t.includes(s), s + "\n" + t)
  assert.ok(!t.includes("…"), t)
})

await test("loop bodies sit behind a guide bar, closed by their keyword", () => {
  const card = M.drawActionCard(el, { data: DATA, reply: M.parseActionReply(ACTION_REPLY), offline: "" }, TERM)
  const bars = findAll(card, (n) => n.t === "Box" && n.p.borderStyle === "quote")
  assert.equal(bars.length, 1)
  assert.match(textOf(bars[0]), /do rm -rf build\/\$b[\s\S]*delete that build folder/)
  assert.ok(!textOf(bars[0]).includes("npm ci"))
})

await test("panels: full width, code boxes for commands, markdown rules", () => {
  const card = M.drawActionCard(el, { data: DATA, reply: M.parseActionReply(ACTION_REPLY), offline: "" }, PANEL)
  assert.equal(card.p.width, "100%")
  assert.deepEqual(findAll(card, (n) => n.t === "Code").map((n) => n.p.source),
                   ["for b in a b", "do rm -rf build/$b", "npm ci"])
  assert.ok(findAll(card, (n) => n.t === "Markdown" && n.p.text === "---").length >= 2)
  // Panels size a row to its longest line: a hidden long line stretches every card to full width.
  assert.equal(findAll(card, (n) => n.p?.key === "stretch" && n.p.height === 0).length, 1)
  const term = M.drawActionCard(el, { data: DATA, reply: M.parseActionReply(ACTION_REPLY), offline: "" }, TERM)
  assert.equal(findAll(term, (n) => n.t === "Code").length, 0)          // the terminal wraps at spaces
  assert.equal(findAll(term, (n) => n.p?.key === "stretch").length, 0)
})

async function actionFlow(opts = {}, options = {}) {
  const eng = engine({ data: DATA, reply: ACTION_REPLY, ...opts })
  const mod = await import(pathToFileURL(modPath).href)
  mod.register(eng.on, options)
  const h = eng.hooks
  const render = async () => textOf(await h["ui.render:ToolUse"](eng.$, { props: { tool_use_id: "b1" }, viewport: { columns: 100, rows: 50 } },
                                                          async () => "● Bash(for b in a b; …)"))
  return { ...eng, h, render }
}

await test("command prompt: analysis by the script, card by the model, summary after", async () => {
  const f = await actionFlow()
  await f.h["tool.check"](f.$, { tool: "Bash", input: CMD, tool_use_id: "b1", approver: "person" }, async () => ({ decision: "ask" }))
  await settle()
  assert.equal(f.calls.runs.length, 0)                          // nothing until the prompt opens
  await f.h["classic.PermissionRequest"](f.$, { tool_name: "Bash", tool_input: CMD, transcript_path: "/t.jsonl", session_id: "s1" }, async () => ({}))
  await settle()
  assert.deepEqual(f.calls.runs[0].argv, ["python3", "/plug/scripts/explain_action.py", "--card-data"])
  assert.equal(JSON.parse(f.calls.runs[0].stdin).transcript_path, "/t.jsonl")
  assert.deepEqual([f.calls.model[0].system, f.calls.model[0].prompt], ["SYS", "PROMPT"])
  assert.match(await f.render(), /Before you approve[\s\S]*delete that build folder/)
  await f.h["tool.call"](f.$, { tool: "Bash", input: CMD, tool_use_id: "b1" }, async () => ({}))
  assert.equal(await f.render(), "● Bash(for b in a b; …)\nwhy: Rebuilds from scratch to rule out a stale build.")
})

await test("hosts (VS Code panel, desktop) get the card without a terminal prompt", async () => {
  const f = await actionFlow()
  await f.h["tool.check"](f.$, { tool: "Bash", input: CMD, tool_use_id: "b1", approver: "host" }, async () => ({ decision: "ask" }))
  await settle()
  assert.equal(f.calls.model.length, 1)
  assert.match(await f.render(), /Before you approve/)
  const root = await f.h["ui.render:ToolUse"](f.$, { props: { tool_use_id: "b1" }, surface: "vscode", viewport: { columns: 60, rows: 40 } },
                                               async () => "row")
  assert.equal(root.p.width, undefined)                         // the engine refuses a width around its own row
})

await test("folded tool groups unfold while a call has a card", async () => {
  const f = await actionFlow()
  await f.h["tool.check"](f.$, { tool: "Bash", input: CMD, tool_use_id: "b1", approver: "host" }, async () => ({ decision: "ask" }))
  let seen
  await f.h["ui.render:ToolGroup"](f.$, { component: "ToolGroup", props: { calls: [{ tool_use_id: "b1" }], isExpanded: false } },
                         async (e) => { seen = e.props.isExpanded })
  assert.equal(seen, true)
})

await test("no python: the card still comes, from the model alone", async () => {
  const f = await actionFlow({ data: null })
  await f.h["tool.check"](f.$, { tool: "Bash", input: CMD, tool_use_id: "b1", approver: "host" }, async () => ({ decision: "ask" }))
  await settle()
  assert.equal(f.calls.model.length, 1)
  assert.match(f.calls.model[0].prompt, /for b in a b/)
  assert.match(await f.render(), /python3 not found/)
})

await test("tools option: uncovered tools get nothing", async () => {
  const f = await actionFlow({}, { tools: "WebFetch" })
  await f.h["tool.check"](f.$, { tool: "Bash", input: CMD, tool_use_id: "b1", approver: "host" }, async () => ({ decision: "ask" }))
  await settle()
  assert.equal(f.calls.model.length, 0)
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
