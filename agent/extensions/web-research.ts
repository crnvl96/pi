/*
Set `PERPLEXITY_API_KEY` in your environment.
*/

import Perplexity from "@perplexity-ai/perplexity_ai";
import type {
  SearchCreateParams,
  SearchCreateResponse,
} from "@perplexity-ai/perplexity_ai/resources/search";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExtensionAPI,
  type TruncationResult,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

const PERPLEXITY_API_KEY_ENV = "PERPLEXITY_API_KEY";
const PERPLEXITY_USER_AGENT = "pi-perplexity-web/1.0";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_TOKENS = 20000;
const DEFAULT_MAX_TOKENS_PER_PAGE = 4096;
const DEFAULT_SEARCH_LANGUAGE_FILTER = ["en"];
const MAX_QUERY_WIDTH = 80;

const WEB_SEARCH_TOOL_NAME = "web_search";
const WEB_SEARCH_TOOL_LABEL = "Perplexity Web Search";
const WEB_SEARCH_TOOL_DESCRIPTION =
  "Search online to validate assumptions, find references, enrich context, and return concise page context.";
const WEB_SEARCH_PROMPT_SNIPPET =
  "Use web_search when the user asks to search, look, research, or google something online, or when external context would help validate, enrich, compare, or ground a decision.";
const WEB_SEARCH_PROMPT_GUIDELINES = [
  "Use web_search when the user's prompt semantically asks to search, look, research, or google something online.",
  "Use web_search autonomously when current external information, references, examples, use cases, docs, or real-world context would materially improve the answer.",
  "Use web_search when planning or designing code changes if external sources could help present alternatives, use cases, examples, or tradeoffs suitable for the scope being discussed.",
  "Use web_search before locking in decisions that depend on facts outside the repo, assumptions that should be validated, or tradeoffs where external references would help.",
  "Use web_search with one focused query that directly serves the user's current goal.",
  "After using web_search, use the returned snippets as context, surface uncertainty, and cite URLs when relevant.",
  "Do not use web_search for purely local codebase questions, stable general knowledge, or anything that can be verified from local files.",
];

const webSearchParameters = Type.Object({
  query: Type.String({
    description: "Focused web search query for the current external information need.",
  }),
});

type WebSearchResultHeader = {
  title: string;
  url: string;
  domain?: string;
  date?: string;
  lastUpdated?: string;
};

type WebSearchToolDetails = {
  query: string;
  resultCount: number;
  responseId: string;
  results: WebSearchResultHeader[];
  truncation?: TruncationResult;
};

type FormattedContext = {
  text: string;
  truncation?: TruncationResult;
};

type ToolContent = {
  type: string;
  text?: string;
};

function renderText(text: string): Text {
  return new Text(text, 0, 0);
}

function readApiKey(): string {
  const apiKey = process.env[PERPLEXITY_API_KEY_ENV]?.trim();
  if (apiKey) {
    return apiKey;
  }

  throw new Error(`Missing Perplexity API key. Set ${PERPLEXITY_API_KEY_ENV} in the environment.`);
}

let client: Perplexity | undefined;
function getClient(): Perplexity {
  if (!client) {
    client = new Perplexity({
      apiKey: readApiKey(),
      maxRetries: DEFAULT_MAX_RETRIES,
      timeout: DEFAULT_TIMEOUT_MS,
      defaultHeaders: {
        "User-Agent": PERPLEXITY_USER_AGENT,
      },
    });
  }

  return client;
}

function normalizeQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("query must be a string");
  }

  const query = value.trim();

  if (!query) {
    throw new Error("query must not be empty");
  }

  return query;
}

function createSearchPayload(query: string): SearchCreateParams {
  return {
    query,
    max_results: DEFAULT_MAX_RESULTS,
    max_tokens: DEFAULT_MAX_TOKENS,
    max_tokens_per_page: DEFAULT_MAX_TOKENS_PER_PAGE,
    search_language_filter: DEFAULT_SEARCH_LANGUAGE_FILTER,
  };
}

function getDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function truncateText(text: string, maxWidth = MAX_QUERY_WIDTH): string {
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, maxWidth - 3)}...`;
}

function getFirstTextContent(content: readonly ToolContent[]): string | undefined {
  const first = content[0];
  return first?.type === "text" ? first.text : undefined;
}

function getErrorLine(text: string | undefined): string | undefined {
  if (!text?.toLowerCase().startsWith("error")) return undefined;
  return text.split("\n")[0];
}

function formatResultCount(resultCount: number): string {
  return resultCount === 1 ? "1 result" : `${resultCount} results`;
}

function formatHeaderMeta(
  header: WebSearchResultHeader,
  domainFormat: "plain" | "labeled",
): string[] {
  const meta: string[] = [];

  if (header.domain) {
    meta.push(domainFormat === "labeled" ? `domain: ${header.domain}` : header.domain);
  }

  if (header.date) {
    meta.push(`published: ${header.date}`);
  }

  if (header.lastUpdated) {
    meta.push(`updated: ${header.lastUpdated}`);
  }

  return meta;
}

function toResultHeader(page: SearchCreateResponse.Result): WebSearchResultHeader {
  return {
    title: page.title,
    url: page.url,
    domain: getDomain(page.url),
    date: page.date ?? undefined,
    lastUpdated: page.last_updated ?? undefined,
  };
}

function formatResult(page: SearchCreateResponse.Result, index: number): string {
  const header = toResultHeader(page);
  const meta = formatHeaderMeta(header, "labeled");
  const metaLine = meta.length > 0 ? `${meta.join(" | ")}\n` : "";
  return `[${index}] ${header.title}\n${header.url}\n${metaLine}page extract: ${page.snippet}`;
}

function formatContext(query: string, results: SearchCreateResponse.Result[]): string {
  const renderedResults =
    results.length > 0
      ? results.map((page, index) => formatResult(page, index + 1)).join("\n\n")
      : "No results returned.";

  return `Perplexity web search context for query: ${query}\n\nUse the numbered results below as external context and cite URLs when relevant.\n\n${renderedResults}`;
}

function formatTruncationNotice(truncation: TruncationResult): string {
  const omittedLines = truncation.totalLines - truncation.outputLines;
  const omittedBytes = truncation.totalBytes - truncation.outputBytes;

  return `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${omittedLines} lines (${formatSize(omittedBytes)}) omitted.]`;
}

function formatToolContext(query: string, results: SearchCreateResponse.Result[]): FormattedContext {
  const context = formatContext(query, results);
  const truncation = truncateHead(context, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return { text: context };
  }

  return {
    text: `${truncation.content}\n\n${formatTruncationNotice(truncation)}`,
    truncation,
  };
}

function toToolDetails(
  query: string,
  response: SearchCreateResponse,
  truncation?: TruncationResult,
): WebSearchToolDetails {
  const details: WebSearchToolDetails = {
    query,
    resultCount: response.results.length,
    responseId: response.id,
    results: response.results.map(toResultHeader),
  };

  if (truncation?.truncated) {
    details.truncation = truncation;
  }

  return details;
}

function registerWebSearchTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: WEB_SEARCH_TOOL_NAME,
    label: WEB_SEARCH_TOOL_LABEL,
    description: WEB_SEARCH_TOOL_DESCRIPTION,
    promptSnippet: WEB_SEARCH_PROMPT_SNIPPET,
    promptGuidelines: WEB_SEARCH_PROMPT_GUIDELINES,
    parameters: webSearchParameters,
    execute: async (_toolCallId, params, signal) => {
      const query = normalizeQuery(params.query);
      const result = await getClient().search.create(createSearchPayload(query), { signal });
      const formattedContext = formatToolContext(query, result.results);

      return {
        content: [
          {
            type: "text",
            text: formattedContext.text,
          },
        ],
        details: toToolDetails(query, result, formattedContext.truncation),
      };
    },
    renderCall(args, theme, _context) {
      const query = theme.fg("accent", truncateText(String(args.query ?? "...")));
      return renderText(`${theme.fg("toolTitle", theme.bold(WEB_SEARCH_TOOL_NAME))} ${query}`);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return renderText(theme.fg("warning", "searching"));

      const errorLine = getErrorLine(getFirstTextContent(result.content));
      if (errorLine) {
        return renderText(theme.fg("error", errorLine));
      }

      const details = result.details as Partial<WebSearchToolDetails> | undefined;
      const headers = details?.results ?? [];
      const resultCount = details?.resultCount ?? headers.length;

      let text = theme.fg("success", formatResultCount(resultCount));
      if (details?.truncation?.truncated) {
        text += theme.fg("warning", " (truncated)");
      }
      if (!expanded) return renderText(text);

      for (const [index, header] of headers.entries()) {
        const meta = formatHeaderMeta(header, "plain");

        text += `\n${theme.fg("accent", `[${index + 1}] ${header.title}`)}`;
        text += `\n${theme.fg("dim", header.url)}`;
        if (meta.length > 0) text += `\n${theme.fg("dim", meta.join(" | "))}`;
      }

      return renderText(text);
    },
  });
}

export default function webResearchExtension(pi: ExtensionAPI) {
  registerWebSearchTool(pi);
}
