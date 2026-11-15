@AGENTS.md

## For Claude Code

- Helpers (subagents) load this file and `AGENTS.md` too. A brief to a helper names its task, the files, what done
  looks like and the decisions already made; it does not repeat these rules.
- A helper that changes files works in its own worktree and branch. It opens the pull request; the coordinator
  reviews it and merges it.
- Run a long command with `run_in_background` and end the turn; its end wakes you. Do not poll CI either: the app
  reports failures, conflicts and comments, and a single `gh pr view` reads the state.
