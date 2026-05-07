import { Type } from "typebox";

export const CodeSearchParams = Type.Object({
  query: Type.String({
    description:
      "Programming/API/library/framework/docs/source-code question. Do not use for specific URLs; use perplexity-web-fetch when a URL is provided.",
  }),
  numResults: Type.Optional(
    Type.Number({ description: "Sources to return (default: 5, max: 20)" }),
  ),
});
