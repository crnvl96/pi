export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  answer: string;
  results: SearchResult[];
}

export interface FetchResponse {
  content: string;
  results: SearchResult[];
}

export interface QueryResultData {
  query: string;
  answer: string;
  results: SearchResult[];
  error: string | null;
}

export interface SearchOptions {
  numResults?: number;
  recencyFilter?: "day" | "week" | "month" | "year";
  domainFilter?: string[];
  signal?: AbortSignal;
}

export interface FetchOptions {
  prompt?: string;
  signal?: AbortSignal;
}

export interface StoredMetadataDetails {
  responseId?: string;
  truncated?: boolean;
  fullLength?: number;
  byteSize?: number;
  cacheBytes?: number;
  cacheMaxBytes?: number;
}
