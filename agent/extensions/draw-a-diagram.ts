import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const TMP_DIR = "/tmp";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const DRAW_ASSET_CACHE_SECONDS = 31_536_000;
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const DRAW_ASSETS = {
  "/assets/draw-ui.js": {
    path: join(EXTENSION_DIR, "draw-dist", "draw-ui.js"),
    contentType: "text/javascript; charset=utf-8",
  },
  "/assets/draw-ui.css": {
    path: join(EXTENSION_DIR, "draw-dist", "draw-ui.css"),
    contentType: "text/css; charset=utf-8",
  },
} as const;

let drawAssetVersion: string | undefined;

type SubmitResult = {
  path: string;
  inserted: boolean;
};

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw httpError(
        413,
        `Screenshot is too large. Maximum size is ${Math.round(maxBytes / 1024 / 1024)}MB.`,
      );
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function getHttpStatus(error: unknown): number {
  if (error && typeof error === "object" && "statusCode" in error) {
    const statusCode = Number((error as { statusCode: unknown }).statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) return statusCode;
  }
  return 500;
}

function writeHtml(res: ServerResponse, html: string) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
  res.end(html);
}

function writeText(res: ServerResponse, statusCode: number, text: string) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
  res.end(text);
}

function writeJson(res: ServerResponse, statusCode: number, value: unknown) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
  res.end(JSON.stringify(value));
}

async function getDrawAssetVersion(): Promise<string> {
  if (drawAssetVersion) return drawAssetVersion;

  try {
    const hash = createHash("sha256");
    for (const asset of Object.values(DRAW_ASSETS)) {
      hash.update(await readFile(asset.path));
    }
    drawAssetVersion = hash.digest("hex").slice(0, 16);
    return drawAssetVersion;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Draw UI bundle is missing or unreadable. Run "npm run build:draw" to generate agent/extensions/draw-dist. ${message}`,
    );
  }
}

function isDrawAssetPath(pathname: string): pathname is keyof typeof DRAW_ASSETS {
  return Object.hasOwn(DRAW_ASSETS, pathname);
}

async function writeDrawAsset(res: ServerResponse, pathname: keyof typeof DRAW_ASSETS) {
  const asset = DRAW_ASSETS[pathname];
  const [body, version] = await Promise.all([readFile(asset.path), getDrawAssetVersion()]);
  res.writeHead(200, {
    "Content-Type": asset.contentType,
    "Content-Length": body.byteLength,
    "Cache-Control": `public, max-age=${DRAW_ASSET_CACHE_SECONDS}, immutable`,
    ETag: `"${version}"`,
  });
  res.end(body);
}

function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function renderDrawPage(token: string, assetVersion: string): string {
  const tokenJson = JSON.stringify(token);
  const assetVersionQuery = encodeURIComponent(assetVersion);
  return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>pi draw</title>
	<link rel="stylesheet" href="/assets/draw-ui.css?v=${assetVersionQuery}" />
	<link rel="modulepreload" href="/assets/draw-ui.js?v=${assetVersionQuery}" />
	<style>
		:root {
			--ink: #16130f;
			--paper: #f8f0da;
			--panel: rgba(248, 240, 218, 0.92);
			--accent: #f05a28;
			--accent-dark: #a63416;
			--ok: #176d3a;
			--warn: #9d6500;
			--err: #a31919;
			--shadow: 0 12px 34px rgba(22, 19, 15, 0.22);
		}

		* { box-sizing: border-box; }
		html, body, #root { width: 100%; height: 100%; margin: 0; }
		body {
			background: var(--paper);
			color: var(--ink);
			font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
			overflow: hidden;
		}
		#root { position: fixed; inset: 0; }

		.draw-submit-wrap {
			position: fixed;
			right: 0;
			bottom: 0;
			z-index: 10000;
			padding: 8px;
			border: 1px solid rgba(0, 0, 0, 0.08);
			border-right: 0;
			border-bottom: 0;
			border-radius: 20px 0 0 0;
			background: rgba(255, 255, 255, 0.94);
			box-shadow: 0 3px 10px rgba(0, 0, 0, 0.16), 0 18px 42px rgba(0, 0, 0, 0.12);
			backdrop-filter: blur(18px) saturate(1.15);
		}

		.draw-button {
			appearance: none;
			border: 0;
			border-radius: 12px;
			background: #2f80ed;
			color: white;
			cursor: pointer;
			font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			font-size: 15px;
			font-weight: 700;
			line-height: 1;
			padding: 17px 22px;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
			transition: transform 120ms ease, background 120ms ease, opacity 120ms ease;
		}

		.draw-button:hover:not(:disabled) {
			background: #2374df;
		}

		.draw-button:active:not(:disabled) {
			transform: scale(0.97);
		}

		.draw-button:disabled {
			opacity: 0.5;
			cursor: default;
		}

		.draw-button.is-submitting {
			opacity: 0.72;
		}

		.draw-button.did-submit {
			background: #1f9d55;
		}

		.draw-button.did-error {
			background: #d64545;
		}

		@media (prefers-reduced-motion: reduce) {
			.draw-button { transition: none; }
		}
	</style>
</head>
<body>
	<div id="root"></div>
	<div class="draw-submit-wrap">
		<button id="submit" class="draw-button" type="button" disabled>Submit to Pi</button>
	</div>

	<script>window.__PI_DRAW_TOKEN__ = ${tokenJson};</script>
	<script type="module" src="/assets/draw-ui.js?v=${assetVersionQuery}"></script>
</body>
</html>`;
}

export default function (pi: ExtensionAPI) {
  let server: Server | undefined;
  let baseUrl: string | undefined;
  let token = randomUUID();
  let lastCtx: ExtensionContext | undefined;
  let pageConnected = false;
  const eventClients = new Set<ServerResponse>();

  function setLastCtx(ctx: ExtensionContext) {
    lastCtx = ctx;
  }

  function setPageConnected(connected: boolean) {
    pageConnected = connected;
    if (lastCtx?.hasUI) {
      lastCtx.ui.setStatus("draw", connected ? "draw: open" : undefined);
    }
  }

  function insertScreenshotIntoPrompt(path: string): boolean {
    const ctx = lastCtx;
    if (!ctx?.hasUI) return false;

    const ref = `@${path}`;
    const current = ctx.ui.getEditorText();
    const separator = current.length === 0 || /\s$/.test(current) ? "" : " ";
    ctx.ui.setEditorText(`${current}${separator}${ref}`);
    ctx.ui.notify(`Added drawing to prompt: ${path}`, "info");
    return true;
  }

  async function handleSubmit(req: IncomingMessage): Promise<SubmitResult> {
    const body = await readRequestBody(req, MAX_UPLOAD_BYTES);
    if (body.length === 0) {
      throw httpError(400, "Empty screenshot upload.");
    }
    if (!isPng(body)) {
      throw httpError(415, "Expected a PNG screenshot.");
    }

    const fileName = `pi-draw-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.png`;
    const filePath = join(TMP_DIR, fileName);
    await writeFile(filePath, body, { mode: 0o600 });

    const inserted = insertScreenshotIntoPrompt(filePath);
    return { path: filePath, inserted };
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `http://${HOST}`);

    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && isDrawAssetPath(url.pathname)) {
      await writeDrawAsset(res, url.pathname);
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/draw")) {
      if (url.searchParams.get("token") !== token) {
        writeText(res, 403, "Forbidden");
        return;
      }
      const assetVersion = await getDrawAssetVersion();
      writeHtml(res, renderDrawPage(token, assetVersion));
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      if (url.searchParams.get("token") !== token) {
        writeText(res, 403, "Forbidden");
        return;
      }
      handleEvents(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/closed") {
      if (url.searchParams.get("token") !== token) {
        writeJson(res, 403, { ok: false, error: "Forbidden" });
        return;
      }
      for (const client of eventClients) {
        client.end();
      }
      eventClients.clear();
      setPageConnected(false);
      writeJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/submit") {
      if (url.searchParams.get("token") !== token) {
        writeJson(res, 403, { ok: false, error: "Forbidden" });
        return;
      }

      try {
        const result = await handleSubmit(req);
        writeJson(res, 200, { ok: true, ...result });
      } catch (error) {
        const statusCode = getHttpStatus(error);
        writeJson(res, statusCode, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    writeText(res, 404, "Not found");
  }

  function handleEvents(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("event: ready\ndata: {}\n\n");
    eventClients.add(res);
    setPageConnected(true);

    const ping = setInterval(() => {
      if (!res.destroyed) res.write(": ping\n\n");
    }, 15_000);

    req.on("close", () => {
      clearInterval(ping);
      eventClients.delete(res);
      setPageConnected(eventClients.size > 0);
    });
  }

  async function ensureServer(): Promise<string> {
    if (server && baseUrl) return baseUrl;

    await getDrawAssetVersion();
    token = randomUUID();
    server = createServer((req, res) => {
      void handleRequest(req, res).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
          writeJson(res, 500, { ok: false, error: message });
        } else {
          res.end();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, HOST, () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not determine draw server port.");
    }

    baseUrl = `http://${HOST}:${address.port}`;
    return baseUrl;
  }

  async function openCanvas(ctx: ExtensionContext) {
    setLastCtx(ctx);
    let url: string | undefined;

    try {
      const urlBase = await ensureServer();
      url = `${urlBase}/draw?token=${encodeURIComponent(token)}`;
      await openBrowser(url);
      const message = pageConnected
        ? "Drawing canvas reopened. Click Submit to add a screenshot to the prompt."
        : "Drawing canvas opened. Click Submit to add a screenshot to the prompt.";
      ctx.ui.notify(message, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        url ? `Could not open browser: ${message}. Open ${url} manually.` : `Could not start draw canvas: ${message}`,
        "error",
      );
    }
  }

  async function shutdownServer() {
    for (const client of eventClients) {
      client.end();
    }
    eventClients.clear();
    setPageConnected(false);

    if (!server) return;
    const serverToClose = server;
    server = undefined;
    baseUrl = undefined;
    await new Promise<void>((resolve) => serverToClose.close(() => resolve()));
  }

  pi.on("session_start", (_event, ctx) => {
    setLastCtx(ctx);
  });

  pi.on("session_shutdown", async () => {
    await shutdownServer();
    lastCtx = undefined;
  });

  pi.registerShortcut("alt+w", {
    description: "Open tldraw canvas and add submitted screenshots to the prompt",
    handler: async (ctx) => {
      await openCanvas(ctx);
    },
  });
}
