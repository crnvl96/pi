---
name: conventional-commits
description: |
  Ensure git commits follow a consistent format.
  Use when making git commits.
compatibility: Requires Git.
---

## Workflow

1. Infer from the prompt if the user provided specific file paths/globs and/or additional instructions.
2. Review `git status` and `git diff` to understand the current changes. Limit to argument-specified files if provided.
3. Optionally run `git log -n 50 --pretty=format:%s` to see commonly used scopes.
4. If there are ambiguous extra files, ask the user for clarification before committing.
5. Stage only the intended files, or all changes if no files specified.
6. Run `git commit -m "<subject>"`, and `-m "<body>"` if needed.

## Template

```txt
<type>(<scope>): <summary>

<body>
```

Template rules:

- `type` is required. Use `feat` for new features, `fix` for bug fixes. Other common types: `docs`, `refactor`, `chore`, `test`, `perf`.
- `scope` is optional. Short noun in parentheses for the affected area (e.g. `api`, `parser`, `ui`, etc).
- `summary` is required. Short, imperative, <= 72 chars, no trailing period.
- `body` is optional. If needed, add a blank line after the subject and write short paragraphs.

### Rules

- Do not include breaking-change markers or footers.
- Do not add sign-offs (no `Signed-off-by`).
- Only commit, do not push.
- If it is unclear whether a file should be included, ask the user which files to commit.
