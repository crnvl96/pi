import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { createPerplexityClient } from "./utils.ts";
import { createWebFetchTool } from "./web-fetch.ts";
import { createWebSearchTool } from "./web-search.ts";
import { createWebSearchScopedTool } from "./web-search-scoped.ts";

export default function (pi: ExtensionAPI) {
  const client = createPerplexityClient();
  if (!client) return;

  pi.registerTool(createWebSearchTool(client));
  pi.registerTool(createWebSearchScopedTool(client));
  pi.registerTool(createWebFetchTool(client));
}
