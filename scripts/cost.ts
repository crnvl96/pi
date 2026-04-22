#!/usr/bin/env node

const { readFile } = require("node:fs/promises");
const { join } = require("node:path");

// Expected argument order:
// 1) read price per 1M tokens
// 2) write price per 1M tokens
// 3) cache read price per 1M tokens
// 4) cache write price per 1M tokens

type TokenCounts = {
  read: number;
  write: number;
  cacheRead: number;
  cacheWrite: number;
};

type CostCounts = TokenCounts & {
  total: number;
};

const rootDir = join(__dirname, "..");
const tokensFile = join(rootDir, "agents", "usage.json");

function asFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptyCounts(): TokenCounts {
  return {
    read: 0,
    write: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

function normalizeCounts(value: unknown): TokenCounts {
  if (!value || typeof value !== "object") {
    return emptyCounts();
  }

  const counts = value as {
    read?: unknown;
    write?: unknown;
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };

  return {
    read: asFiniteNumber(counts.read ?? counts.input),
    write: asFiniteNumber(counts.write ?? counts.output),
    cacheRead: asFiniteNumber(counts.cacheRead),
    cacheWrite: asFiniteNumber(counts.cacheWrite),
  };
}

function addCounts(target: TokenCounts, source: TokenCounts): void {
  target.read += source.read;
  target.write += source.write;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
}

function formatMillions(value: number): string {
  return (value / 1_000_000).toFixed(3);
}

function formatDollars(value: number): string {
  return value.toFixed(4);
}

function padCell(value: string, width: number, align: "left" | "right" = "left"): string {
  return align === "right" ? value.padStart(width, " ") : value.padEnd(width, " ");
}

function renderTable(rows: Array<[string, string, string]>): string {
  const headers: [string, string, string] = ["type", "tokens (M)", "cost ($)"];
  const widths = [0, 0, 0];

  for (const row of [headers, ...rows]) {
    widths[0] = Math.max(widths[0], row[0].length);
    widths[1] = Math.max(widths[1], row[1].length);
    widths[2] = Math.max(widths[2], row[2].length);
  }

  const border = `+-${"-".repeat(widths[0])}-+-${"-".repeat(widths[1])}-+-${"-".repeat(widths[2])}-+`;
  const line = (row: [string, string, string], isHeader = false): string => {
    const alignRight = isHeader ? "left" : "right";
    return `| ${padCell(row[0], widths[0])} | ${padCell(row[1], widths[1], alignRight)} | ${padCell(row[2], widths[2], alignRight)} |`;
  };

  return [border, line(headers, true), border, ...rows.map((row) => line(row)), border].join("\n");
}

function parsePrice(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name} price: ${value ?? "<missing>"}`);
  }
  return parsed;
}

function computeCost(tokens: TokenCounts, prices: TokenCounts): CostCounts {
  const read = (tokens.read / 1_000_000) * prices.read;
  const write = (tokens.write / 1_000_000) * prices.write;
  const cacheRead = (tokens.cacheRead / 1_000_000) * prices.cacheRead;
  const cacheWrite = (tokens.cacheWrite / 1_000_000) * prices.cacheWrite;

  return {
    read,
    write,
    cacheRead,
    cacheWrite,
    total: read + write + cacheRead + cacheWrite,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 4) {
    throw new Error(
      "Usage: node ./scripts/cost.ts <read_price_per_1M> <write_price_per_1M> <cache_read_price_per_1M> <cache_write_price_per_1M>",
    );
  }

  const prices: TokenCounts = {
    read: parsePrice(args[0], "read"),
    write: parsePrice(args[1], "write"),
    cacheRead: parsePrice(args[2], "cache read"),
    cacheWrite: parsePrice(args[3], "cache write"),
  };

  let rawUsage: unknown;
  try {
    rawUsage = JSON.parse(await readFile(tokensFile, "utf8"));
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code === "ENOENT") {
      throw new Error(`Missing ${tokensFile}. Run node ./scripts/usage.ts first.`);
    }
    throw error;
  }

  const usageByDate = rawUsage && typeof rawUsage === "object" ? rawUsage : {};
  const totalTokens = emptyCounts();

  for (const date of Object.keys(usageByDate).sort((left, right) => left.localeCompare(right))) {
    const tokens = normalizeCounts((usageByDate as Record<string, unknown>)[date]);
    addCounts(totalTokens, tokens);
  }

  const totalCost = computeCost(totalTokens, prices);
  const rows: Array<[string, string, string]> = [
    ["read", formatMillions(totalTokens.read), formatDollars(totalCost.read)],
    ["write", formatMillions(totalTokens.write), formatDollars(totalCost.write)],
    ["cacheRead", formatMillions(totalTokens.cacheRead), formatDollars(totalCost.cacheRead)],
    ["cacheWrite", formatMillions(totalTokens.cacheWrite), formatDollars(totalCost.cacheWrite)],
    [
      "total",
      formatMillions(totalTokens.read + totalTokens.write + totalTokens.cacheRead + totalTokens.cacheWrite),
      formatDollars(totalCost.total),
    ],
  ];

  console.log(renderTable(rows));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
