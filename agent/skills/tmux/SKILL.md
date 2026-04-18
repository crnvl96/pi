---
name: tmux
description: |
  TMUX integration.
  Use when performing I/O operations and session manipulation using TMUX.
compatibility: Requires tmux.
---

## Rules

- Always send the command to window 1, pane 1.
  e.g. `tmux send-keys -t 1.1 -- 'ls -la' Enter`.
- Prefer literal sends to avoid shell splitting.
  e.g. `tmux send-keys -t 1.1 -l -- "$cmd"`.
- When composing inline commands, use single quotes or ANSI C quoting to avoid expansion.
  e.g. `tmux send-keys -t 1.1 -- $'python3 -m http.server 8000'`.
- To send control keys.
  e.g. `tmux send-keys -t 1.1 C-c, C-d, C-z, Escape, etc`.
- Send code with `-l`.
  e.g. `tmux send-keys -t 1.1 -l -- $'for i in range(3):\n    print(i)'`.
- Interrupt with `C-c`.
  e.g. `tmux send-keys -t 1.1 C-c`.
- When starting a python interactive shell, always set the `PYTHON_BASIC_REPL=1` environment variable.
  e.g. `tmux send-keys -t 1.1 -- 'PYTHON_BASIC_REPL=1 python3' Enter`.
  This is very important as the non-basic console interferes with your send-keys.
