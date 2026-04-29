import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendSeparated,
  getBrowserOpenCommand,
  getErrorMessage,
  isPng,
  toHtmlSafeJson,
} from "./utils.ts";

const HOST = "127.0.0.1";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

let server: ReturnType<typeof createServer> | undefined;
let baseUrl: string | undefined;
let token = randomUUID();
let lastCtx: ExtensionContext | undefined;

function send(res: ServerResponse, status: number, contentType: string, body = "") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_UPLOAD_BYTES) throw new Error("Screenshot is too large.");
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function openBrowser(url: string) {
  const { command, args } = getBrowserOpenCommand(process.platform, url);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function addScreenshotToPrompt(path: string) {
  if (!lastCtx?.hasUI) return false;

  const text = lastCtx.ui.getEditorText();
  lastCtx.ui.setEditorText(appendSeparated(text, `@${path}`));
  lastCtx.ui.notify(`Added drawing to prompt: ${path}`, "info");
  return true;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${HOST}`);

  if (req.method === "GET" && url.pathname === "/assets/draw.js") {
    send(
      res,
      200,
      "text/javascript; charset=utf-8",
      await readFile(join(EXTENSION_DIR, "dist", "draw.js"), "utf8"),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/assets/draw.css") {
    send(
      res,
      200,
      "text/css; charset=utf-8",
      await readFile(join(EXTENSION_DIR, "dist", "draw.css"), "utf8"),
    );
    return;
  }

  if (url.searchParams.get("token") !== token) {
    send(res, 403, "text/plain; charset=utf-8", "Forbidden");
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/draw")) {
    send(
      res,
      200,
      "text/html; charset=utf-8",
      (await readFile(join(EXTENSION_DIR, "src", "draw.html"), "utf8")).replace(
        "{{tokenJson}}",
        toHtmlSafeJson(token),
      ),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/submit") {
    try {
      const body = await readBody(req);
      if (!body.length) throw new Error("Empty screenshot upload.");
      if (!isPng(body)) throw new Error("Expected a PNG screenshot.");

      const path = join("/tmp", `pi-draw-${Date.now()}-${randomUUID().slice(0, 8)}.png`);
      await writeFile(path, body, { mode: 0o600 });
      send(
        res,
        200,
        "application/json; charset=utf-8",
        JSON.stringify({ ok: true, path, inserted: addScreenshotToPrompt(path) }),
      );
    } catch (error) {
      send(
        res,
        400,
        "application/json; charset=utf-8",
        JSON.stringify({
          ok: false,
          error: getErrorMessage(error),
        }),
      );
    }
    return;
  }

  send(res, 404, "text/plain; charset=utf-8", "Not found");
}

async function ensureServer() {
  if (baseUrl) return baseUrl;

  token = randomUUID();
  server = createServer(
    (req, res) =>
      void handleRequest(req, res).catch((error) =>
        send(res, 500, "text/plain; charset=utf-8", getErrorMessage(error)),
      ),
  );

  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, HOST, resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not determine draw server port.");

  baseUrl = `http://${HOST}:${address.port}`;
  return baseUrl;
}

async function openCanvas(ctx: ExtensionContext) {
  lastCtx = ctx;
  let url: string | undefined;

  try {
    url = `${await ensureServer()}/draw?token=${encodeURIComponent(token)}`;
    await openBrowser(url);
    ctx.ui.notify("Drawing canvas opened. Click Submit to add a screenshot to the prompt.", "info");
  } catch (error) {
    const message = getErrorMessage(error);
    ctx.ui.notify(
      url
        ? `Could not open browser: ${message}. Open ${url} manually.`
        : `Could not start drawing canvas: ${message}`,
      "error",
    );
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    server = undefined;
    baseUrl = undefined;
    lastCtx = undefined;
  });

  pi.registerCommand("ext:draw", {
    description: "Open a drawing canvas and add the screenshot to the prompt",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) await openCanvas(ctx);
      else ctx.ui.notify("draw requires interactive mode", "error");
    },
  });

  pi.registerShortcut("alt+d", {
    description: "Open drawing canvas",
    handler: openCanvas,
  });
}
