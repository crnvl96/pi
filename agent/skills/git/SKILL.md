---
name: git
description: |
  Git integration.
  Use when running git commands, syncing repositories, managing branches, tags, or remotes.
compatibility: Requires git.
---

## Guidelines

- When asked to sync local and remote environments, sync both remote branches and tags.
  e.g. `git fetch --prune origin && git fetch --tags --prune --prune-tags origin`.
- Always fast-forward the checked-out or requested local branch after fetching.
  e.g. `git pull --ff-only origin main`.
- Prefer fast-forward-only updates when syncing. Do not merge, rebase, force-push, or reset unless explicitly requested.
- Before deleting a local branch whose remote was pruned, verify it is merged or ask for confirmation.
  e.g. `git branch --merged main` then `git branch -d <branch>`.
