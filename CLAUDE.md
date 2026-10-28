# che

A Claude Code plugin marketplace with one plugin, `che`:
whenever Claude Code asks the user to approve a step, a review card appears
right above the prompt.

- Shell commands, web fetches, connector (MCP) tools: Why, Part, Does (every
  part of the command word for word, each with its meaning), Effects, Beyond,
  Watch, So far.
- File edits and writes: File, Change, Why, Logic (pseudocode with + ~ − markers),
  Watch.

## Layout

- `plugins/che/hooks/cards.js`: the hooks module (a Claude
  Code "mod", needs Claude Code 2.1.287+). Triggers, model calls, drawing.
- `plugins/che/scripts/explain_action.py`: stdlib-only
  analysis for commands, called by cards.js with `--card-data` (JSON in/out).
  Splits shell commands into verbatim parts (connectors, loop/if nesting),
  static risk checks, session context from the transcript, the model prompt.
  Also `--doctor` and `--preview "<command>"`.
- `plugins/che/tests/`: `python3 tests/test_explain_action.py`
  and `node tests/test_cards.mjs` (fake engine). Run both after any change.
- `dev/e2e/`: real Claude Code in a pty against a mock API; see its README.

## How the cards work (facts learned the hard way)

- Hook text (PreToolUse `permissionDecisionReason`) is plain text, capped at
  ~2000 chars, never shown in file-edit prompts, and not shown in the VS Code
  panel. That's why everything moved to the mod.
- The card is drawn at the `ToolUse` render site, under the step's transcript
  row, which sits right above the permission dialog. The dialog itself can't be
  restyled. Reads/Bash calls are often folded into a `ToolGroup`
  ("Running 1 shell command…"); cards.js unfolds a group while one of its calls
  has a card.
- Trigger: `tool.check` records calls whose verdict is `ask`; the card starts on
  `classic.PermissionRequest` (fires only when the terminal dialog really opens),
  or right away when `e.approver === "host"` (VS Code panel, desktop). The card
  shows "explaining…" first and fills in when the model answers; the dialog is
  never delayed.
- Model calls go through `$.model.complete` (session's own login, Haiku by
  default). Command cards: the prompt and system text come from the Python
  script; replies are labelled lines parsed in `parseActionReply`. Edit cards:
  `buildPrompt` / `parseReply` in cards.js.
- VS Code panel draws mods with extension 2.1.299+ in sessions that fetch
  feature flags. It ignores some props (Text `size`/`mono`, Code highlighting);
  repeated-character rules don't fit its proportional font, so panels get a
  Markdown `---` rule and commands in `Code` boxes, the terminal gets `─` rules
  and word-wrapped Text. Not tested in the panel itself yet.
- `claude plugin validate .` must pass. Its static analysis requires `$` to be
  passed only to top-level functions (not closures defined inside `register`).

## What the user wants

- Everything shows: no truncation, no "left out to fit", every part of a
  command verbatim. Height is not a constraint.
- Clear, airy layout: sections separated by a rule and blank lines, labels in
  their own column, sentence case, no emoji (a coloured risk label is fine).
- One display mechanism (the mod), full panel width.
- The next focus is the quality of the explanations, especially for edits:
  pseudocode and plain-English summaries good enough to review a change without
  reading the language. The user has an idea about programming-language
  subtleties to discuss. Ideas already offered: before → after behaviour for
  concrete inputs; pseudocode of the whole enclosing function with changed
  lines marked; callers affected by the change (search the repo); checking
  WATCH claims against the code instead of trusting the model.

## Releasing

Bump `version` in `plugins/che/.claude-plugin/plugin.json`
and `VERSION` in `explain_action.py` together. Users restart Claude Code (or
run `/reload-plugins`) to pick up a new version.
