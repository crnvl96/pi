#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

type UsageCounts = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

type CostCounts = UsageCounts & {
  total: number;
};

type TotalsByDate = Record<string, UsageCounts>;

type FileState = {
  size: number;
  mtimeMs: number;
  totals: TotalsByDate;
};

type UsageState = {
  version: 2;
  files: Record<string, FileState>;
};

type ModelPreset = UsageCounts & {
  name: string;
};

type SessionMessageEntry = {
  type?: unknown;
  timestamp?: unknown;
  message?: {
    role?: unknown;
    timestamp?: unknown;
    usage?: {
      input?: unknown;
      output?: unknown;
      cacheRead?: unknown;
      cacheWrite?: unknown;
    };
  };
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, "..");
const sessionsDir = join(rootDir, "agent", "sessions");
const stateFile = join(rootDir, ".tokens-state.json");

// Prices are in USD per 1M tokens. Update these presets as needed.
const modelPresets: ModelPreset[] = [
  {
    name: "Kimi 2.6",
    input: 0.8,
    output: 3.5,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  {
    name: "GLM 5.1",
    input: 1.06,
    output: 4.4,
    cacheRead: 0.26,
    cacheWrite: 0.0,
  },
  {
    name: "Opus 4.7",
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 0.0,
  },
  {
    name: "GPT 5.4",
    input: 5,
    output: 15,
    cacheRead: 0.25,
    cacheWrite: 0.0,
  },
  {
    name: "Gemini 3.1 Pro Preview",
    input: 2,
    output: 12,
    cacheRead: 0.2,
    cacheWrite: 0.375,
  },
];

function asFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptyCounts(): UsageCounts {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

function normalizeCounts(value: unknown): UsageCounts {
  if (!value || typeof value !== "object") {
    return emptyCounts();
  }

  const counts = value as {
    input?: unknown;
    output?: unknown;
    read?: unknown;
    write?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };

  return {
    input: asFiniteNumber(counts.input ?? counts.read),
    output: asFiniteNumber(counts.output ?? counts.write),
    cacheRead: asFiniteNumber(counts.cacheRead),
    cacheWrite: asFiniteNumber(counts.cacheWrite),
  };
}

function cloneCounts(counts?: unknown): UsageCounts {
  return normalizeCounts(counts);
}

function addCounts(target: UsageCounts, source: Partial<UsageCounts>): void {
  target.input += asFiniteNumber(source.input);
  target.output += asFiniteNumber(source.output);
  target.cacheRead += asFiniteNumber(source.cacheRead);
  target.cacheWrite += asFiniteNumber(source.cacheWrite);
}

function normalizeTotals(value: unknown): TotalsByDate {
  if (!value || typeof value !== "object") {
    return {};
  }

  const totals: TotalsByDate = {};
  for (const [date, counts] of Object.entries(value)) {
    if (typeof date !== "string") {
      continue;
    }
    totals[date] = cloneCounts(counts);
  }

  return sortTotalsByDate(totals);
}

function sortTotalsByDate(totals: TotalsByDate): TotalsByDate {
  return Object.fromEntries(
    Object.entries(totals)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, counts]) => [date, cloneCounts(counts)]),
  );
}

function toDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTimestamp(entry: SessionMessageEntry): number {
  const messageTimestamp = asFiniteNumber(entry.message?.timestamp);
  if (messageTimestamp > 0) {
    return messageTimestamp;
  }

  if (typeof entry.timestamp === "string") {
    const parsed = Date.parse(entry.timestamp);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function addEntryUsage(totals: TotalsByDate, entry: SessionMessageEntry): void {
  if (entry.type !== "message") {
    return;
  }

  if (entry.message?.role !== "assistant") {
    return;
  }

  const usage = entry.message.usage;
  if (!usage) {
    return;
  }

  const timestamp = getTimestamp(entry);
  if (timestamp <= 0) {
    return;
  }

  const dateKey = toDateKey(timestamp);
  const counts = totals[dateKey] ?? emptyCounts();
  counts.input += asFiniteNumber(usage.input);
  counts.output += asFiniteNumber(usage.output);
  counts.cacheRead += asFiniteNumber(usage.cacheRead);
  counts.cacheWrite += asFiniteNumber(usage.cacheWrite);
  totals[dateKey] = counts;
}

async function listSessionFiles(rootDirectory: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [rootDirectory];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException;
      if (maybeError.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      const resolvedPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(resolvedPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(resolvedPath);
      }
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

async function scanFileRange(filePath: string, start: number, end: number): Promise<TotalsByDate> {
  if (end < start) {
    return {};
  }

  const totals: TotalsByDate = {};
  const stream = createReadStream(filePath, {
    encoding: "utf8",
    start,
    end,
  });
  const lines = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      try {
        addEntryUsage(totals, JSON.parse(trimmed) as SessionMessageEntry);
      } catch {
        continue;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return totals;
}

function combineTotals(files: Record<string, FileState>): TotalsByDate {
  const totals: TotalsByDate = {};

  for (const fileState of Object.values(files)) {
    for (const [date, counts] of Object.entries(fileState.totals)) {
      const current = totals[date] ?? emptyCounts();
      addCounts(current, counts);
      totals[date] = current;
    }
  }

  return sortTotalsByDate(totals);
}

async function loadState(): Promise<UsageState> {
  try {
    const content = await readFile(stateFile, "utf8");
    const parsed = JSON.parse(content) as Partial<UsageState>;
    const files = parsed.files && typeof parsed.files === "object" ? parsed.files : {};

    const normalizedFiles: Record<string, FileState> = {};
    for (const [filePath, fileState] of Object.entries(files)) {
      const state = fileState as Partial<FileState> | undefined;
      normalizedFiles[filePath] = {
        size: asFiniteNumber(state?.size),
        mtimeMs: asFiniteNumber(state?.mtimeMs),
        totals: normalizeTotals(state?.totals),
      };
    }

    return {
      version: 2,
      files: normalizedFiles,
    };
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code === "ENOENT") {
      return {
        version: 2,
        files: {},
      };
    }

    console.warn(`[usage_report] Ignoring unreadable state file: ${stateFile}`);
    return {
      version: 2,
      files: {},
    };
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const json = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tempFile, json, "utf8");
  await rename(tempFile, filePath);
}

async function processFile(
  filePath: string,
  previousState?: FileState,
): Promise<{ mode: string; state: FileState }> {
  const snapshot = await stat(filePath);

  if (
    previousState &&
    snapshot.size === previousState.size &&
    snapshot.mtimeMs === previousState.mtimeMs
  ) {
    return {
      mode: "skipped",
      state: {
        size: snapshot.size,
        mtimeMs: snapshot.mtimeMs,
        totals: normalizeTotals(previousState.totals),
      },
    };
  }

  if (previousState && snapshot.size > previousState.size) {
    const deltaTotals = await scanFileRange(filePath, previousState.size, snapshot.size - 1);
    const mergedTotals = normalizeTotals(previousState.totals);

    for (const [date, counts] of Object.entries(deltaTotals)) {
      const current = mergedTotals[date] ?? emptyCounts();
      addCounts(current, counts);
      mergedTotals[date] = current;
    }

    return {
      mode: "incremental",
      state: {
        size: snapshot.size,
        mtimeMs: snapshot.mtimeMs,
        totals: sortTotalsByDate(mergedTotals),
      },
    };
  }

  const fullTotals = await scanFileRange(filePath, 0, snapshot.size - 1);
  return {
    mode: previousState ? "rescanned" : "new",
    state: {
      size: snapshot.size,
      mtimeMs: snapshot.mtimeMs,
      totals: sortTotalsByDate(fullTotals),
    },
  };
}

function formatMillions(value: number): string {
  return (value / 1_000_000).toFixed(3);
}

function formatDollars(value: number): string {
  return value.toFixed(4);
}

function padCell(value: string, width: number, align: "left" | "right"): string {
  return align === "right" ? value.padStart(width, " ") : value.padEnd(width, " ");
}

function renderTable(
  headers: string[],
  rows: string[][],
  alignments: Array<"left" | "right">,
): string {
  const widths = headers.map((header) => header.length);

  for (const row of rows) {
    for (const [index, value] of row.entries()) {
      widths[index] = Math.max(widths[index], value.length);
    }
  }

  const border = `+-${widths.map((width) => "-".repeat(width)).join("-+-")}-+`;
  const line = (row: string[], isHeader = false): string => {
    const cells = row.map((value, index) => {
      const align = isHeader ? "left" : (alignments[index] ?? "left");
      return padCell(value, widths[index], align);
    });
    return `| ${cells.join(" | ")} |`;
  };

  return [border, line(headers, true), border, ...rows.map((row) => line(row)), border].join("\n");
}

function flattenTotals(totalsByDate: TotalsByDate): UsageCounts {
  const totals = emptyCounts();

  for (const counts of Object.values(totalsByDate)) {
    addCounts(totals, counts);
  }

  return totals;
}

function computeCost(tokens: UsageCounts, prices: UsageCounts): CostCounts {
  const input = (tokens.input / 1_000_000) * prices.input;
  const output = (tokens.output / 1_000_000) * prices.output;
  const cacheRead = (tokens.cacheRead / 1_000_000) * prices.cacheRead;
  const cacheWrite = (tokens.cacheWrite / 1_000_000) * prices.cacheWrite;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}

function buildUsageRows(totals: UsageCounts): string[][] {
  const grandTotal = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;

  return [
    ["input", formatMillions(totals.input)],
    ["output", formatMillions(totals.output)],
    ["cache read", formatMillions(totals.cacheRead)],
    ["cache write", formatMillions(totals.cacheWrite)],
    ["total", formatMillions(grandTotal)],
  ];
}

function buildCostRows(totals: UsageCounts, presets: ModelPreset[]): string[][] {
  return presets.map((preset) => {
    const cost = computeCost(totals, preset);
    return [
      preset.name,
      formatDollars(cost.input),
      formatDollars(cost.output),
      formatDollars(cost.cacheRead),
      formatDollars(cost.cacheWrite),
      formatDollars(cost.total),
    ];
  });
}

async function main(): Promise<void> {
  const previousState = await loadState();
  const files = await listSessionFiles(sessionsDir);
  const nextFiles: Record<string, FileState> = {};

  let skipped = 0;
  let incremental = 0;
  let rescanned = 0;
  let newFiles = 0;

  for (const filePath of files) {
    const relativePath = relative(sessionsDir, filePath).split("\\").join("/");
    const previousFileState = previousState.files[relativePath];
    const result = await processFile(filePath, previousFileState);
    nextFiles[relativePath] = result.state;

    if (result.mode === "skipped") {
      skipped += 1;
    } else if (result.mode === "incremental") {
      incremental += 1;
    } else if (result.mode === "new") {
      newFiles += 1;
    } else {
      rescanned += 1;
    }
  }

  let removed = 0;
  for (const relativePath of Object.keys(previousState.files)) {
    if (!(relativePath in nextFiles)) {
      removed += 1;
    }
  }

  const nextState: UsageState = {
    version: 2,
    files: nextFiles,
  };
  const totalsByDate = combineTotals(nextFiles);
  const totals = flattenTotals(totalsByDate);

  await writeJsonAtomically(stateFile, nextState);

  console.log(
    `files=${files.length} skipped=${skipped} incremental=${incremental} rescanned=${rescanned} new=${newFiles} removed=${removed}`,
  );
  console.log("");
  console.log("Usage");
  console.log(renderTable(["type", "tokens (M)"], buildUsageRows(totals), ["left", "right"]));

  if (modelPresets.length === 0) {
    console.log("");
    console.log("No model presets configured.");
    return;
  }

  console.log("");
  console.log("Cost by model preset");
  console.log(
    renderTable(
      ["model", "input ($)", "output ($)", "cache read ($)", "cache write ($)", "total ($)"],
      buildCostRows(totals, modelPresets),
      ["left", "right", "right", "right", "right", "right"],
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
