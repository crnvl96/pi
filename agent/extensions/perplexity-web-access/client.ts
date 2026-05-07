export interface WebSearchConfig {
  searchModel: string;
  summaryModel: string;
  perplexityApiKey?: unknown;
}

export const WEB_SEARCH_CONFIG: WebSearchConfig = {
  searchModel: "openai-codex/gpt-5.4-mini",
  summaryModel: "openai-codex/gpt-5.4-mini",
};

export function loadConfig(): WebSearchConfig {
  return WEB_SEARCH_CONFIG;
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
      "Perplexity API key not found. Set PERPLEXITY_API_KEY environment variable.\n" +
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
