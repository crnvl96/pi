import { Type } from "typebox";

export const GetContentParams = Type.Object({
  responseId: Type.String({
    description: "The responseId returned by a Perplexity web access tool",
  }),
  queryIndex: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Retrieve a specific stored query/code-search item by zero-based index",
    }),
  ),
  urlIndex: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Retrieve a specific stored fetch URL by zero-based index",
    }),
  ),
});
