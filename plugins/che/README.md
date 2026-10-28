# che

A Claude Code plugin. Whenever Claude Code stops to ask for your approval, a
review card appears right above the prompt, so you can follow the course of
action at a glance and approve with confidence.

- **Shell commands, web fetches, connector (MCP) tools:** why Claude wants the
  step, which part of your task it serves, every part of the command word for
  word with what it does, its effects and risk, and what Claude did so far.
- **File edits and writes:** what the file is, what the change does and why,
  the new logic as **pseudocode**, and the subtle points worth a second look.

## What it looks like

Captured from Claude Code 2.1.311 in the terminal (the text came from a test
model; the layout is exactly what you get). In colour, the border and the risk
chip follow the risk, connectors and commands are highlighted, and pseudocode
markers are green, yellow and red. In the VS Code panel the same card fills the
panel's width, with commands in code boxes.

```
  ╭────────────────────────────────────────────────────────────────────────────────────────────────────╮
  │                                                                                                    │
  │  Before you approve    Low risk    Investigate                                                     │
  │                                                                                                    │
  │  Why       Checks whether PRs 515 and 517 include the PR 510 commit and set the revision field,    │
  │            to see if the bug is still open there.                                                  │
  │  Part      Finds out whether the PR 510 fix reached the branches behind PRs 515 and 517.           │
  │                                                                                                    │
  │  ────────────────────────────────────────────────────────────────────────────────────────────────  │
  │                                                                                                    │
  │  Does      Fetches the two PR branches, then for each one checks for the PR 510 commit and         │
  │            searches the code for the revision field.                                               │
  │                                                                                                    │
  │  1. $  git fetch -q origin jbelo/sc-203120/xks-endpoint-disconnect-stale-attempts                  │
  │        jbelo/sc-203120/xks-endpoint-disconnect-require                                             │
  │        download both branches from origin, without progress output                                 │
  │                                                                                                    │
  │  2. && for b in xks-endpoint-disconnect-stale-attempts xks-endpoint-disconnect-require             │
  │        only if the fetch worked: repeat parts 3 to 8 once per branch, as $b                        │
  │                                                                                                    │
  │      ▎ 3. $  do r=origin/jbelo/sc-203120/$b                                                        │
  │      ▎       name that branch's remote copy r                                                      │
  │      ▎                                                                                             │
  │      ▎ 4. $  echo "=== $b"                                                                         │
  │      ▎       print a header line with the branch name                                              │
  │      ▎                                                                                             │
  │      ▎ 5. $  git merge-base --is-ancestor bab46441 $r                                              │
  │      ▎       check whether the PR 510 commit is in that branch's history                           │
  │      ▎                                                                                             │
  │      ▎ 6. && echo "contains 510 commit"                                                            │
  │      ▎       if it is, say so                                                                      │
  │      ▎                                                                                             │
  │      ▎ 7. || echo "does NOT contain 510 commit"                                                    │
  │      ▎       if it isn't, say that instead                                                         │
  │      ▎                                                                                             │
  │      ▎ 8. $  git grep -n                                                                           │
  │      ▎       "KeyStoreConnectionStatusRevision\s*[:=]\|EffectiveConnectionStatusRevision()" $r     │
  │      ▎       -- xkshealth keyservice ':!*_test.go' ':!vendor'                                      │
  │      ▎       find where that branch sets the revision field in xkshealth and keyservice,           │
  │      ▎       skipping tests and vendored code                                                      │
  │                                                                                                    │
  │        done                                                                                        │
  │                                                                                                    │
  │  ────────────────────────────────────────────────────────────────────────────────────────────────  │
  │                                                                                                    │
  │  Effects   Network fetch from origin; updates two remote-tracking branches. No files in your       │
  │            working tree change.                                                                    │
  │  Watch     Nothing flagged                                                                         │
  │                                                                                                    │
  │  ────────────────────────────────────────────────────────────────────────────────────────────────  │
  │                                                                                                    │
  │  So far    Nothing yet: this is the first step since your message   →   This step                  │
  │                                                                                                    │
  ╰────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

```
  ╭──────────────────────────────────────────────────────────────────────────────────────────────────────────╮
  │                                                                                                          │
  │  In plain English    Medium risk    Lines 2–5  ·  +4 −1                                                  │
  │                                                                                                          │
  │  File      Token helpers the login flow uses to decide whether a session token is still valid            │
  │  Change    isExpired now treats a token with no expiry as expired, and counts a token as expired         │
  │            slightly early to allow for clock drift.                                                      │
  │  Why       Fixes the failing login test you asked about: tokens without an expiry were accepted          │
  │            forever.                                                                                      │
  │                                                                                                          │
  │  ──────────────────────────────────────────────────────────────────────────────────────────────────────  │
  │                                                                                                          │
  │  Logic     + new    ~ changed    − removed                                                               │
  │                                                                                                          │
  │  ╭────────────────────────────────────────────────────────────────────────────────────────────────────╮  │
  │  │                                                                                                    │  │
  │  │     function isExpired(exp, now):                                                                  │  │
  │  │  +    if the token has no expiry (exp is missing):                                                 │  │
  │  │  +      report it as expired                                                                       │  │
  │  │  −    expired only when exp is before now                                                          │  │
  │  │  ~    expired when exp is at or before now minus CLOCK_SKEW_MS                                     │  │
  │  │                                                                                                    │  │
  │  ╰────────────────────────────────────────────────────────────────────────────────────────────────────╯  │
  │                                                                                                          │
  │  ──────────────────────────────────────────────────────────────────────────────────────────────────────  │
  │                                                                                                          │
  │  Watch     • CLOCK_SKEW_MS is used but not defined or imported in this file                              │
  │            • < became <=: a token expiring exactly now is now treated as expired                         │
  │                                                                                                          │
  ╰──────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

The card appears the moment the prompt opens ("explaining this step before you
approve…") and fills in a few seconds later; the prompt itself is never held
up. Once you answer, the card folds into one line under the step
(`why: …` or `plain English: …`).

### Shell commands

| Row | What it tells you |
| --- | --- |
| **Header** | Risk, and which phase of the task this is (investigate, fix, verify, set up, clean up, deliver) |
| **Why** | What the step is for, in terms of your request |
| **Part** | Which piece of your request it moves forward |
| **Does** | One sentence, then **every part of the command, word for word**, with what it does on the line below. `$` starts a statement, `&&` runs only if the previous part succeeded, `\|\|` only if it failed, `\|` receives its output. Loop and `if` bodies sit behind a guide bar, closed by `done` or `fi` |
| **Effects** | Files changed or deleted, network, installs, processes |
| **Beyond** | Anything the step does that your request doesn't need |
| **Watch** | Static checks: `rm -rf`, `curl … \| sh`, force-push, `sudo`, destructive SQL, cloud deletes, secrets files, … |
| **So far** | What Claude did since your last message (✓ done, ✗ failed) |

The parts are taken apart by the plugin itself, not the model, so nothing is
merged, shortened or left out; the model only writes what each part means. The
risk is the higher of the model's rating and the static checks.

### File edits

| Row | What it tells you |
| --- | --- |
| **Header** | Risk, the lines touched, lines added and removed |
| **File** | What this file is for in the project |
| **Change** | What the edit does, in plain English |
| **Why** | Why Claude is making it, tied to your request |
| **Logic** | The new or changed logic as pseudocode, nested like the code, with function and variable names kept so you can map back: green `+` new, yellow `~` changed, red `−` removed, dim unchanged context |
| **Watch** | What a reviewer could miss: changed edge cases (`<` became `<=`), names used but never defined, swallowed errors, language gotchas, security or data-loss risks. Edits to secrets files, CI config, lockfiles, migrations, Claude's own settings, or files outside the project are flagged whatever the model says |

## Where it works

The cards are drawn by Claude Code itself, as part of its transcript, so they
work wherever Claude Code draws one: the terminal (including VS Code with **Use
Terminal**), and the VS Code panel and desktop app, which draw plugin cards too
(tested in the terminal only). There is no length limit: everything shows.

A card appears only when a prompt really opens. Steps Claude Code lets through
on its own (read-only commands, your allow rules, accept-edits or auto mode)
get no card and cost nothing.

Needs **Claude Code 2.1.287 or later** and `python3` on your PATH.

## Install or update

From GitHub:

```bash
claude plugin marketplace add <github-user>/<this-repo>
claude plugin install che@che
```

Update with `claude plugin marketplace update che`, then
`claude plugin update che@che`.

From a local clone (handy while developing): `claude plugin marketplace add
~/path/to/clone`. Claude Code then reads the plugin straight from that folder,
so `git pull` is the update.

Either way, restart Claude Code afterwards: a session that was already open
keeps the version it started with.

## Not seeing cards?

Run the doctor from your project folder:

```bash
python3 ~/tools/che/plugins/che/scripts/explain_action.py --doctor
```

It shows which copy and version of the plugin Claude Code runs, whether Claude
Code loads the cards and, if not, why (Claude Code too old, hooks disabled, an
organization policy, Claude Code not offering plugin modules to your account
yet), and whether the command analysis works.

To see how a command will be taken apart, without Claude:

```bash
python3 …/scripts/explain_action.py --preview "find . -name '*.log' -print0 | xargs -0 rm -f"
```

## How it works

- `hooks/cards.js` is a hooks module, a kind of plugin code that runs inside
  Claude Code. It notices when a step needs your approval (the
  PermissionRequest event, or a host such as the VS Code panel being asked),
  gathers what the card needs, asks a small model (Haiku, through your session's
  own login) to write it, and draws it under the step's transcript row.
- `scripts/explain_action.py` takes shell commands apart (every part, its
  connector and nesting), runs the static risk checks, reads the session
  transcript for your request, Claude's narration, its to-do list and the steps
  so far, and builds the model's prompt. It makes no model call itself.
- For edits, the module reads the file, works out the change with line numbers,
  and sends the change plus up to 90 lines of the file around it.

**What goes to the model:** your latest message, Claude's recent narration, the
recent actions with short result snippets, and the pending step (for edits, the
change and the file around it), through your Claude Code login. Set
`backend=local` and nothing is sent: cards then show the static analysis and
Claude's own description of the step.

The cards are advice. The model can be wrong; for anything marked HIGH, read the
step itself.

## Options

Set them with `/plugin configure che@che` (or
`/config`).

| Option | Default | Meaning |
| --- | --- | --- |
| `backend` | `auto` | `auto`: a small model writes the cards. `local`: no model, instant and offline, less insight |
| `model` | `haiku` | Model alias or full model ID |
| `language` | `English` | Language of the card text |
| `timeout_seconds` | `20` | After this, the card shows what the plugin knows without the model |
| `tools` | `Bash,PowerShell,WebFetch,mcp` | Which tools' prompts get a card (`mcp` = every connector tool) |
| `explain_edits` | `true` | The plain-English card above file-edit prompts |
| `breakdown_min_length` | `40` | A single command this long is still broken into parts; chained, piped and multi-line commands always are |

## Tests

```bash
python3 tests/test_explain_action.py -v
node tests/test_cards.mjs
```

They use temporary files and a fake engine, need no login, and don't touch your
configuration.
