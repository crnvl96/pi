import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
  withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { ApiSearchRequest, ApiSearchResponse } from "./client.ts";
import { searchWeb } from "./client.ts";
import { formatSearchContext } from "./format.ts";

const opts = {
  max_results: 3,
  country: undefined,
  max_tokens: undefined,
  max_tokens_per_page: undefined,
  search_language_filter: ["en"],
  search_domain_filter: undefined,
  search_recency_filter: undefined,
  last_updated_after_filter: undefined,
  last_updated_before_filter: undefined,
  search_after_date_filter: undefined,
  search_before_date_filter: undefined,
} satisfies Omit<ApiSearchRequest, "query">;

interface PerplexitySearchDetails {
  request: ApiSearchRequest;
  response: ApiSearchResponse;
  resultCount: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

function compactList(values: string[] | undefined): string[] | undefined {
  if (!values) {
    return undefined;
  }

  const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function buildPayload(query: string): ApiSearchRequest {
  const payload: ApiSearchRequest = {
    query: query.trim(),
    max_results: opts.max_results,
    country: opts.country?.trim().toUpperCase(),
    max_tokens: opts.max_tokens,
    max_tokens_per_page: opts.max_tokens_per_page,
    search_language_filter: compactList(opts.search_language_filter),
    search_domain_filter: compactList(opts.search_domain_filter),
    search_recency_filter: opts.search_recency_filter,
    last_updated_after_filter: opts.last_updated_after_filter?.trim(),
    last_updated_before_filter: opts.last_updated_before_filter?.trim(),
    search_after_date_filter: opts.search_after_date_filter?.trim(),
    search_before_date_filter: opts.search_before_date_filter?.trim(),
  };

  if (!payload.query) {
    throw new Error("query must not be empty");
  }

  return payload;
}

export default function perplexitySearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "perplexity_web_search",
    label: "Perplexity Web Search",
    description: `Search the web using the Perplexity Search API and return ranked results. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first). If truncated, full output is saved to a temp file.`,
    promptSnippet:
      "Search the web using Perplexity when up-to-date external information is needed. Rewrite the user's wording into a strong web search query when helpful, and run multiple focused searches if that is more likely to find better results.",
    promptGuidelines: [
      "Use this tool when the user asks for current web information, news, docs, or sources outside the local codebase.",
      "Prefer this tool over bash/curl for web search when up-to-date external information is needed.",
      "Do not feel forced to use the user's words literally. Extract the real intent, entities, constraints, and time range, then turn that into a better search query.",
      "When useful, broaden, narrow, or rephrase the query to improve recall and precision.",
      "If one query is unlikely to be enough, run multiple targeted searches that cover different interpretations or subtopics, then synthesize the results.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    execute: async (_toolCallId, params, signal) => {
      const payload = buildPayload(params.query);
      const result = await searchWeb(payload, signal);
      const fullText = formatSearchContext(payload.query, result.results);
      const truncation = truncateHead(fullText, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      const details: PerplexitySearchDetails = {
        request: payload,
        response: result,
        resultCount: result.results.length,
      };

      let resultText = truncation.content;

      if (truncation.truncated) {
        const tempDir = await mkdtemp(join(tmpdir(), "pi-perplexity-search-"));
        const tempFile = join(tempDir, "output.txt");
        await withFileMutationQueue(tempFile, async () => {
          await writeFile(tempFile, fullText, "utf8");
        });

        details.truncation = truncation;
        details.fullOutputPath = tempFile;

        const truncatedLines = truncation.totalLines - truncation.outputLines;
        const truncatedBytes = truncation.totalBytes - truncation.outputBytes;

        resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
        resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
        resultText += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
        resultText += ` Full output saved to: ${tempFile}]`;
      }

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
        details,
      };
    },
    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("perplexity_web_search "));
      text += theme.fg("accent", `"${args.query}"`);
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, _context) {
      const details = result.details as PerplexitySearchDetails | undefined;

      if (isPartial) {
        return new Text(theme.fg("warning", "Searching web..."), 0, 0);
      }

      if (!details) {
        return new Text(theme.fg("dim", "No results"), 0, 0);
      }

      const label = details.resultCount === 1 ? "1 result" : `${details.resultCount} results`;
      let text = theme.fg(details.resultCount > 0 ? "success" : "dim", label);

      if (details.truncation?.truncated) {
        text += theme.fg("warning", " (truncated)");
      }

      if (expanded) {
        const content = result.content[0];
        if (content?.type === "text") {
          const lines = content.text.split("\n");
          const previewLines = lines.slice(0, 16);
          for (const line of previewLines) {
            text += `\n${theme.fg("dim", line)}`;
          }
          if (lines.length > previewLines.length) {
            text += `\n${theme.fg("muted", "... (use read tool to see full output)")}`;
          }
        }

        if (details.fullOutputPath) {
          text += `\n${theme.fg("dim", `Full output: ${details.fullOutputPath}`)}`;
        }
      }

      return new Text(text, 0, 0);
    },
  });
}
