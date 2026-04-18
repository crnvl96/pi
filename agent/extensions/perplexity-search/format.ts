import type { ApiSearchPage } from "./client.ts";

function getDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export function formatResult(page: ApiSearchPage, index: number): string {
  const meta: string[] = [];
  const domain = getDomain(page.url);
  if (domain) {
    meta.push(`domain: ${domain}`);
  }
  if (page.date) {
    meta.push(`published: ${page.date}`);
  }
  if (page.last_updated) {
    meta.push(`updated: ${page.last_updated}`);
  }

  const metaLine = meta.length > 0 ? `${meta.join(" | ")}\n` : "";
  return `[${index + 1}] ${page.title}\n${page.url}\n${metaLine}snippet: ${page.snippet}`;
}

export function formatSearchContext(query: string, pages: ApiSearchPage[]): string {
  const renderedResults =
    pages.length > 0
      ? pages.map((page, index) => formatResult(page, index)).join("\n\n")
      : "No results returned.";

  return `Perplexity web search context for: ${query}\n\nUse the numbered results below as external context and cite URLs when relevant.\n\n${renderedResults}`;
}
