# Perplexity Search pi extension

This extension adds a `perplexity_web_search` tool to pi.

## Auth

Store the Perplexity API key in `agent/auth.json` under `perplexity.apiKey`.

Example:

```json
{
  "perplexity": {
    "apiKey": "your-api-key"
  }
}
```

## Tool

`perplexity_web_search`

Use it to search the web with the Perplexity Search API.

## Notes

- This extension calls `POST https://api.perplexity.ai/search` directly with `fetch()`.
- No Perplexity SDK dependency is required.
- The tool returns formatted text plus the raw API response in `details`.
- Formatted output is truncated to pi's standard line and byte limits. When truncation happens, the full text is written to a temp file and the path is included in the tool output.
