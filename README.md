# Pi Config

Personal configuration for [`pi`](https://www.npmjs.com/package/@mariozechner/pi-coding-agent). This repo is intended to live at `~/.pi`.

## Prerequisites

- Node.js 24. This repo includes `mise.toml`, so with mise:

  ```bash
  mise install
  ```

- `pi` installed and available on your `PATH`.
- Linux browser opening uses `xdg-open`; make sure it is installed if you use the draw extension.

## Fresh setup

```bash
cd ~/.pi
npm ci
npm run build
```

Then restart pi, or run `/reload` inside pi.

## Useful commands

```bash
npm run build       # Build generated extension assets
npm run build:draw  # Rebuild only the draw board browser bundle
npm run typecheck   # Type-check the config/extensions
npm run lint        # Lint the config/extensions
```

## Draw extension

`agent/extensions/draw-a-diagram.ts` registers `alt+w` to open a local tldraw board. The board UI is bundled locally under `agent/vendor/draw/` for faster startup:

- Source: `agent/vendor/draw/draw-src/draw-ui.ts`
- Generated assets: `agent/vendor/draw/draw-dist/draw-ui.js` and `.css`

After changing `agent/vendor/draw/draw-src/draw-ui.ts`, run:

```bash
npm run build:draw
```

If pi reports that the draw UI bundle is missing, run the same command and reload pi.

## Important files

- `agent/settings.json` — default model/provider and global behavior.
- `agent/keybindings.json` — editor and app keybinding overrides.
- `agent/extensions/` — auto-loaded pi extensions.
- `agent/skills/` — custom pi skills.
- `agent/AGENTS.md` — local instructions for coding agents.

## Local/private files

Do not commit secrets or local session history:

- `agent/auth.json`
- `agent/sessions/`
- `node_modules/`

These are ignored by `.gitignore`.
