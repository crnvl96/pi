/*
## Auth

Set `PERPLEXITY_API_KEY` in your environment.
*/

import Perplexity from "@perplexity-ai/perplexity_ai";
import type {
  ResponseCreateParams,
  ResponseCreateResponse,
} from "@perplexity-ai/perplexity_ai/resources/responses";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

type FetchPage = {
  snippet: string;
  title: string;
  url: string;
};

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MODEL = "openai/gpt-5.4";

function readApiKey(): string {
  const apiKey = process.env.PERPLEXITY_API_KEY?.trim();
  if (apiKey) {
    return apiKey;
  }

  throw new Error("Missing Perplexity API key. Set PERPLEXITY_API_KEY in the environment.");
}

let client: Perplexity | undefined;

function getClient(): Perplexity {
  if (!client) {
    client = new Perplexity({
      apiKey: readApiKey(),
      maxRetries: DEFAULT_MAX_RETRIES,
      timeout: DEFAULT_TIMEOUT_MS,
      defaultHeaders: {
        "User-Agent": "pi-perplexity-web-fetch/1.0",
      },
    });
  }

  return client;
}

function normalizeUrl(input: string): string {
  const urlText = input.trim();

  if (!urlText) {
    throw new Error("url must not be empty");
  }

  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new Error(`Invalid URL: ${urlText}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("url must start with http:// or https://");
  }

  return url.toString();
}

function extractFetchedPages(response: ResponseCreateResponse): FetchPage[] {
  const pages: FetchPage[] = [];

  for (const item of response.output) {
    if (item.type !== "fetch_url_results") {
      continue;
    }

    for (const content of item.contents) {
      pages.push({
        snippet: content.snippet,
        title: content.title,
        url: content.url,
      });
    }
  }

  return pages;
}

function formatResult(page: FetchPage, index: number): string {
  const meta: string[] = [];

  try {
    meta.push(`domain: ${new URL(page.url).hostname}`);
  } catch {}

  const metaLine = meta.length > 0 ? `${meta.join(" | ")}\n` : "";
  return `[${index + 1}] ${page.title}\n${page.url}\n${metaLine}page extract: ${page.snippet}`;
}

function formatFetchContext(requestedUrl: string, pages: FetchPage[]): string {
  const renderedResults =
    pages.length > 0 ? pages.map(formatResult).join("\n\n") : "No fetched content returned.";

  return `Perplexity web fetch context for: ${requestedUrl}\n\nUse the fetched page content below as external context and cite the URL when relevant.\nThe page extract text comes from Perplexity's fetch_url tool for the exact requested URL.\n\n${renderedResults}`;
}

export default function perplexityWebFetchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_fetch",
    label: "Perplexity Web Fetch",
    description:
      "Fetch the content of a specific URL using the Perplexity Agent API and return extracted page text.",
    promptSnippet:
      "Fetch a specific URL using Perplexity when the user already knows the exact page they want to inspect.",
    promptGuidelines: [
      "Use this tool when the user provides a specific URL and wants the content of that exact page.",
      "Prefer this tool over general web search when the target URL is already known.",
      "Pass the exact URL the user wants fetched.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The full http(s) URL to fetch" }),
    }),
    execute: async (_toolCallId, params, signal) => {
      const url = normalizeUrl(params.url);

      const payload: ResponseCreateParams = {
        model: DEFAULT_MODEL,
        input: url,
        instructions:
          "Use fetch_url to fetch the exact URL from the user input. Do not use web_search. After fetching, respond with exactly: Fetched.",
        tools: [
          {
            type: "fetch_url",
            max_urls: 1,
          },
        ],
      };

      const result = await getClient().responses.create(payload, { signal });
      const pages = extractFetchedPages(result);

      if (pages.length === 0) {
        const outputText = result.output_text?.trim();
        if (outputText) {
          throw new Error(
            `Perplexity did not return fetched page content. Model response: ${outputText}`,
          );
        }

        throw new Error("Perplexity did not return fetched page content.");
      }

      return {
        content: [
          {
            type: "text",
            text: formatFetchContext(url, pages),
          },
        ],
        details: {
          requestedUrl: url,
          fetchedUrls: pages.map((page) => page.url),
          resultCount: pages.length,
        },
      };
    },
    renderCall(args, theme, _context) {
      return new Text(
        theme.fg("toolTitle", theme.bold("web_fetch ")) + theme.fg("accent", `"${args.url}"`),
        0,
        0,
      );
    },
  });
}
