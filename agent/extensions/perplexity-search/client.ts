import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type SearchRecencyFilter = "hour" | "day" | "week" | "month" | "year";

export type ApiSearchRequest = {
  query: string;
  max_results?: number;
  country?: string;
  max_tokens?: number;
  max_tokens_per_page?: number;
  search_language_filter?: string[];
  search_domain_filter?: string[];
  last_updated_after_filter?: string;
  last_updated_before_filter?: string;
  search_after_date_filter?: string;
  search_before_date_filter?: string;
  search_recency_filter?: SearchRecencyFilter;
};

export type ApiSearchPage = {
  title: string;
  url: string;
  snippet: string;
  date?: string | null;
  last_updated?: string | null;
};

export type ApiSearchResponse = {
  results: ApiSearchPage[];
  id: string;
  server_time?: string | null;
};

const authFilePath = path.join(homedir(), ".pi", "agent", "auth.json");

async function readApiKey(): Promise<string> {
  const envApiKey = process.env.PERPLEXITY_API_KEY?.trim();
  if (envApiKey) {
    return envApiKey;
  }

  try {
    const auth = JSON.parse(await readFile(authFilePath, "utf8")) as {
      perplexity?: {
        apiKey?: string;
      };
    };

    const fileApiKey = auth.perplexity?.apiKey?.trim();
    if (fileApiKey) {
      return fileApiKey;
    }
  } catch {
    // Fall through to the explicit error below.
  }

  throw new Error(
    `Missing Perplexity API key. Set PERPLEXITY_API_KEY or add perplexity.apiKey to ${authFilePath}`,
  );
}

export async function searchWeb(
  params: ApiSearchRequest,
  signal?: AbortSignal,
): Promise<ApiSearchResponse> {
  const apiKey = await readApiKey();

  const response = await fetch("https://api.perplexity.ai/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Perplexity search failed with status ${response.status}: ${body}`);
  }

  return (await response.json()) as ApiSearchResponse;
}
