#!/usr/bin/env node

const { createReadStream } = require("node:fs");
const { mkdir, readdir, readFile, rename, stat, writeFile } = require("node:fs/promises");
const { dirname, join, relative } = require("node:path");
const { createInterface } = require("node:readline");

type TokenCounts = {
  read: number;
  write: number;
  cacheRead: number;
  cacheWrite: number;
};

type TotalsByDate = Record<string, TokenCounts>;

type FileState = {
  size: number;
  mtimeMs: number;
  totals: TotalsByDate;
};

type UsageState = {
  version: 1;
  files: Record<string, FileState>;
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

const rootDir = join(__dirname, "..");
const sessionsDir = join(rootDir, "agent", "sessions");
const outputFile = join(rootDir, "agents", "usage.json");
const stateFile = join(rootDir, ".tokens-state.json");

function emptyCounts(): TokenCounts {
  return {
    read: 0,
    write: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

function asFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function cloneCounts(counts?: Partial<TokenCounts>): TokenCounts {
  return {
    read: asFiniteNumber(counts?.read),
    write: asFiniteNumber(counts?.write),
    cacheRead: asFiniteNumber(counts?.cacheRead),
    cacheWrite: asFiniteNumber(counts?.cacheWrite),
  };
}

function addCounts(target: TokenCounts, source: Partial<TokenCounts>): void {
  target.read += asFiniteNumber(source.read);
  target.write += asFiniteNumber(source.write);
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
    totals[date] = cloneCounts(counts as Partial<TokenCounts>);
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
  counts.read += asFiniteNumber(usage.input);
  counts.write += asFiniteNumber(usage.output);
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
      version: 1,
      files: normalizedFiles,
    };
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code === "ENOENT") {
      return {
        version: 1,
        files: {},
      };
    }

    console.warn(`[token_usage] Ignoring unreadable state file: ${stateFile}`);
    return {
      version: 1,
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

async function processFile(filePath: string, previousState?: FileState): Promise<{ mode: string; state: FileState }> {
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
    version: 1,
    files: nextFiles,
  };
  const totals = combineTotals(nextFiles);

  await writeJsonAtomically(stateFile, nextState);
  await writeJsonAtomically(outputFile, totals);

  console.log(`Wrote ${outputFile}`);
  console.log(
    `files=${files.length} skipped=${skipped} incremental=${incremental} rescanned=${rescanned} new=${newFiles} removed=${removed}`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
