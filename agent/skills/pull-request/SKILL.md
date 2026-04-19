---
name: pull-request
description: Open a GitHub pull request for the current work. Use when user asks to create a pull request, open a PR, or prepare a branch and PR with gh CLI.
---

Create a GitHub pull request for the current work using `gh`.
The branch name must always start with `crnvl96/`.
The pull request body must use bullet points that explain the main implementation points.

## Notes

- Before doing anything else, check for uncommitted changes with `git status --short`.
- If there are uncommitted changes, ask the user whether they should be committed first, and do not continue until they answer.
- If the current branch does not start with `crnvl96/`, create or rename the branch so it does.
- Use `gh pr create` to open the pull request.
- If the branch has not been pushed yet, push it with upstream tracking before creating the pull request.
- Infer a clear PR title from the branch name, commit history, and diff. Ask the user only if the title would be too speculative.
- Build the PR body as concise bullet points covering what changed, why it matters, and any notable implementation decisions.
- Do not merge the PR.
- Treat any caller-provided arguments as additional PR guidance. They may influence the branch name suffix, PR title, or PR body.

## Steps

1. Run `git status --short` and stop to ask the user if there are uncommitted changes.
2. Inspect the current branch with `git branch --show-current`.
3. If needed, create or rename the branch so its name starts with `crnvl96/`.
4. Review `git log`, `git diff`, and `git status` to understand the change set.
5. Determine the base branch if needed.
6. Push the branch with `git push -u origin <branch>` if it is not already on the remote.
7. Run `gh pr create --title "<title>" --body "- point 1\n- point 2\n- point 3"`.
8. Return the PR URL and a short summary of the title, branch, and body points.
