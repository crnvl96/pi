import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WebSearchConfig {
  perplexityApiKey?: unknown;
}

const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

let cachedConfig: WebSearchConfig | null = null;

export function loadConfig(): WebSearchConfig {
  if (cachedConfig) return cachedConfig;

  if (!existsSync(CONFIG_PATH)) {
    cachedConfig = {};
    return cachedConfig;
  }

  const content = readFileSync(CONFIG_PATH, "utf-8");

  try {
    cachedConfig = JSON.parse(content) as WebSearchConfig;
    return cachedConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
  }
}

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function getApiKey(): string {
  const config = loadConfig();
  const key =
    normalizeApiKey(process.env["PERPLEXITY_API_KEY"]) ?? normalizeApiKey(config.perplexityApiKey);
  if (!key) {
    throw new Error(
      "Perplexity API key not found. Either:\n" +
        `  1. Create ${CONFIG_PATH} with { "perplexityApiKey": "your-key" }\n` +
        "  2. Set PERPLEXITY_API_KEY environment variable\n" +
        "Get a key at https://perplexity.ai/settings/api",
    );
  }
  return key;
}

export function isPerplexityAvailable(): boolean {
  const config = loadConfig();
  return !!(
    normalizeApiKey(process.env["PERPLEXITY_API_KEY"]) ?? normalizeApiKey(config.perplexityApiKey)
  );
}
