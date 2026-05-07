import { Type } from "typebox";
import { searchWithPerplexity, type SearchOptions, type SearchResult } from "./search.js";

export interface FetchOptions {
  prompt?: string;
  signal?: AbortSignal;
}

export interface FetchResponse {
  content: string;
  results: SearchResult[];
}

export const FetchParams = Type.Object({
  url: Type.Optional(Type.String({ description: "Single HTTP/HTTPS URL to read or summarize" })),
  urls: Type.Optional(
    Type.Array(Type.String(), {
      description: "Multiple HTTP/HTTPS URLs to read or summarize with up to 3 concurrent requests",
    }),
  ),
  prompt: Type.Optional(
    Type.String({
      description:
        "Question or instruction for extraction from the provided URL(s). Pass the user's specific question here when they ask about a particular aspect of the page.",
    }),
  ),
});

export function buildFetchQuery(url: string, prompt?: string): string {
  const normalizedPrompt = prompt?.trim();
  if (normalizedPrompt) {
    return [
      "Using the content available at this URL, answer the user's request in clear markdown.",
      "Include important details, preserve source attribution, and cite source URLs when relevant.",
      "If the page cannot be fully accessed, say what is unavailable instead of inventing details.",
      "",
      `User request: ${normalizedPrompt}`,
      "",
      `URL: ${url}`,
    ].join("\n");
  }

  return [
    "Fetch and extract the readable content from this URL as markdown.",
    "Preserve the title, key facts, important details, and source attribution.",
    "If the page cannot be fully accessed, summarize the accessible content and say what is unavailable.",
    "",
    `URL: ${url}`,
  ].join("\n");
}

export async function fetchUrlWithPerplexity(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResponse> {
  const query = buildFetchQuery(url, options.prompt);
  const searchOptions: SearchOptions = {};
  if (options.signal) searchOptions.signal = options.signal;

  const { answer, results } = await searchWithPerplexity(query, searchOptions);
  return { content: answer, results };
}
