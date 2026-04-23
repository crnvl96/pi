import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("report script runs under node and prints the report sections", () => {
  const result = spawnSync(process.execPath, ["scripts/report.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\bUsage\b/);
  assert.match(result.stdout, /Cost by model preset/);
});

test("report script resolves paths from its own ESM location and writes state at repo root", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "report-script-"));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await mkdir(join(tempRoot, "scripts"), { recursive: true });
  await mkdir(join(tempRoot, "agent", "sessions", "demo"), { recursive: true });
  await cp(join(repoRoot, "scripts", "report.ts"), join(tempRoot, "scripts", "report.ts"));
  await writeFile(
    join(tempRoot, "package.json"),
    JSON.stringify({ type: "module" }, null, 2) + "\n",
    "utf8",
  );
  await writeFile(
    join(tempRoot, "agent", "sessions", "demo", "session.jsonl"),
    [
      JSON.stringify({
        type: "message",
        timestamp: "2026-04-23T00:00:00.000Z",
        message: {
          role: "assistant",
          usage: {
            input: 1000,
            output: 500,
            cacheRead: 250,
            cacheWrite: 125,
          },
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );

  const result = spawnSync(process.execPath, ["scripts/report.ts"], {
    cwd: tempRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /files=1/);
  assert.match(result.stdout, /Usage/);

  const statePath = join(tempRoot, ".tokens-state.json");
  const state = JSON.parse(await readFile(statePath, "utf8")) as {
    version: number;
    files: Record<string, { totals: Record<string, { input: number }> }>;
  };

  assert.equal(state.version, 2);
  assert.deepEqual(Object.keys(state.files), ["demo/session.jsonl"]);

  const savedTotals = Object.values(state.files["demo/session.jsonl"]?.totals ?? {});
  const totalInput = savedTotals.reduce((sum, counts) => sum + counts.input, 0);
  assert.equal(totalInput, 1000);
});
