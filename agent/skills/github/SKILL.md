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

## Releases and tags

Before suggesting or creating release tags:

1. Sync refs: `git fetch origin --prune --tags`.
2. Treat remote as source of truth: compare local tags with `git ls-remote --tags --refs origin`.
3. Check GitHub Release objects too: `gh release list --limit 20 --json tagName,isPrerelease,publishedAt`.
4. Suggest the next tag from remote stable tags/releases, then verify proposed tag/release does not already exist remotely.
5. Create flow: local tag -> `git push origin <tag>` -> `gh release create <tag> --verify-tag`.

Remember: Git tags and GitHub Releases are different objects; either can be missing while the other exists.
