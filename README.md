# che

A local Claude Code plugin marketplace with one plugin:
**che**. Whenever Claude Code asks for your approval, a review card appears above the prompt. For shell commands, web fetches and connector tools it shows why Claude wants the step, which part of your task it serves, every part of the command word for word with what it does, the effects and risk, and what Claude did so far. For file edits it shows what the change does and why, and its logic as pseudocode.

```bash
claude plugin marketplace add <github-user>/<this-repo>      # or a local clone's path
claude plugin install che@che
```

Then restart Claude Code. Needs Claude Code 2.1.287 or later and `python3`. Details and troubleshooting:
[plugins/che/README.md](plugins/che/README.md)

## Development

```bash
cd plugins/che
python3 tests/test_explain_action.py && node tests/test_cards.mjs
claude plugin validate .
```

`dev/e2e/` runs the real Claude Code against a mock API and saves what the
screen shows, to check the cards end to end. `CLAUDE.md` has the design notes.
