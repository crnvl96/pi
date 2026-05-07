---
name: github
description: |
  gh integration.
  Use when interacting with github via its CLI tool `gh`.
compatibility: Requires gh and jq.
---

## Guidelines

- Prefer structured JSON output when `gh` results will be parsed or piped to another tool.
  e.g. `gh issue list --json number,title --jq '.[] | "\(.number): \(.title)"'`.
- Most resource commands support `--json <fields>` plus `--jq <expr>` for jq-style filtering.
  Omit the field list to discover valid fields for a command.
  e.g. `gh pr list --json number,title,author --jq '.[] | {number, title, author: .author.login}'`.
- Use `gh api` for data not available through higher-level subcommands; API responses are JSON and support `--jq`.
  e.g. `gh api repos/:owner/:repo/pulls/123/files --jq '.[].filename'`.
- Prefer JSON plus `--jq` or external `jq` over parsing tables or human-readable text.
  e.g. `gh run list --json databaseId,status,conclusion | jq '.[] | select(.conclusion == "failure")'`.
- Always use `gh pr merge --merge` when merging pull requests; do not use squash or rebase merge unless explicitly instructed.
