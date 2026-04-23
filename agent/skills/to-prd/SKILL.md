---
name: to-prd
description: Turn the current conversation context and codebase understanding into a product requirements document. Use when the user wants a PRD synthesized from the existing discussion rather than a fresh discovery interview.
---

# To PRD

Turn the current conversation context and codebase understanding into a PRD.

Do not restart discovery with an open-ended interview. Synthesize what you already know, then ask only targeted follow-up questions when implementation or testing decisions still need confirmation.

## Process

1. Explore the repo to understand the current state of the codebase, if you have not already.
2. Sketch the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.
3. Confirm only the decisions that still need alignment:
   - whether the proposed modules match the user's expectations
   - which modules they want tests written for
4. Write the PRD using [the template](references/prd-template.md).

A deep module encapsulates a lot of functionality behind a simple, testable interface that rarely changes.

## Guidelines

- Describe the problem and solution from the user's perspective.
- Keep implementation decisions concrete enough to guide work.
- Describe testing in terms of external behavior, not implementation details.
- Do not include specific file paths or code snippets in the PRD.
