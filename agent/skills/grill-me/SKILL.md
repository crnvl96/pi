---
name: grill-me
description: |
  Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree.
  Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding.
Walk down each branch of the design tree, resolving dependencies between decisions one by one. For each question, append your recommended answer.
Make your questions in batches up to 10 items per batch.
Each batch must be in the format of a numbered list, where each "question + recommended answer" compose one list item.
If a question can be answered by exploring the codebase, explore the codebase instead.

Batch Template:

```markdown
1. **Question**: <question-ending-with-question-mark>
   **Recommended Answer**: <recommended-answer-in-one-paragraph>
   <examples-and-snippets>
```

Examples:

````markdown
1. **Question**: What is the accepted response contract?
   **Recommended answer**: Always return:

   ```json
   {
     "job_id": "...",
     "status": "accepted",
     "idempotency_key": "...",
     "upload_url": "...",
     "expires_at": "..."
   }
   ```

   If duplicate idempotency key, return the original job_id.

2. **Question**: What JSON Schema subset do we accept?
   **Recommended answer**: A provider-neutral subset:

- root type: object
- properties
- required
- additionalProperties
- string, number, integer, boolean, array, object, null
- enum
- description
- basic min/max constraints
  Reject complex oneOf, anyOf, allOf, conditional schemas, recursive refs for MVP.

3. **Question**: How do we identify consumers?
   **Recommended answer**: MVP uses API keys, one per consumer, stored hashed in DynamoDB/Secrets Manager. Every job/metric/webhook event is tagged with consumer_id.
````
