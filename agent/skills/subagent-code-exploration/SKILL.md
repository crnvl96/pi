---
name: subagent-code-exploration
description: Delegate codebase exploration to a pi subagent through bash using pi --print, especially when the user asks to spawn a subagent, use another model for discovery, or find where behavior is implemented without changing files.
---

# Subagent Code Exploration

Use this skill when the user wants code exploration delegated to another pi agent, especially with wording like "spawn yourself as a subagent", "use `pi --print`", "ask another model to inspect the codebase", or "find where X is implemented".

## Core workflow

1. Spawn a non-interactive pi subagent from `bash`.
2. Give the subagent a narrow, read-only exploration task.
3. Return the subagent's findings clearly.
4. Do not perform extra local exploration unless it is necessary or the user asked for verification. If you do verify, say so explicitly.

## Recommended command

Prefer a read-only tool allowlist and no session persistence:

```bash
pi --print \
  --no-session \
  --model openrouter/deepseek/deepseek-v4-flash \
  --tools read,bash \
  "Find where <behavior> is implemented in this project. Report relevant files, functions, and call path briefly. Do not modify files. Keep the answer concise."
```

Run it through the `bash` tool with bounded output:

```bash
pi --print --no-session --model openrouter/deepseek/deepseek-v4-flash --tools read,bash "<task>" 2>&1 | head -c 12000
```

Use a timeout appropriate for exploration, for example 120-180 seconds.

## Prompting the subagent

Include:

- The exact thing to find.
- That the task is read-only: "Do not modify files."
- Desired output shape: files, functions, call path, and short summary.
- Any user-requested model/provider. For "OpenRouter DeepSeek v4 Flash", use:
  `openrouter/deepseek/deepseek-v4-flash`.

Good prompt template:

```text
Find where <feature/behavior> is performed in this project. Inspect the codebase and report the relevant file(s), function(s), and call path briefly. Do not modify files.
```

## Verification policy

The lesson from prior use: after delegating, silently running your own `rg` or other exploration can surprise the user if they specifically asked for subagent delegation.

Follow this policy:

- If the user only asked to delegate exploration, run the subagent and report its answer.
- If the subagent output is ambiguous, incomplete, or risky to trust, do one of:
  - ask the user whether to verify, or
  - briefly state: "I am going to verify the subagent's findings with a targeted read-only search."
- If you verify, keep it surgical and bounded, e.g. targeted `rg` with `head -c`.
- In the final response, disclose verification: "I also verified with a targeted search".

## Final response format

Keep the response short:

```text
Spawned subagent with `pi --print --model ...`.

Findings:
- `path/file.ext:line` — what happens there
- `path/other.ext:line` — caller/callee

Call path:
`entrypoint -> function -> implementation`
```

If no verification was performed, do not imply that you personally inspected the code.
If verification was performed, mention it explicitly.

## Safety and context hygiene

- Use `--tools read,bash` for exploration-only tasks.
- Use `--no-session` unless the user wants a persisted subagent session.
- Cap unknown output with `head -c` or `tail -c`.
- Do not let the subagent make changes unless the user explicitly requested implementation work.
- Do not broaden the task beyond the user's request.
