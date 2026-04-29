---
name: slice
description: Break a PRD into sequential slices using tracer-bullet vertical slices. Use when user wants to enhance a PRD by defining issues.
---

## 1. Gather context

Work from whatever is already in the conversation context AND a PRD file reference that user will send or that you will proactively ask for before anything.

## 2. Explore the codebase

- If you have not already explored the codebase, do so to understand the current state of the code. 
- Use the project's domain glossary vocabulary, and respect any ADRs in the area you're touching.

## 3. Draft vertical slices

- Break the PRD into tracer bullet issues.
- Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.
- Each slice delivers a narrow but COMPLETE path through every application layer.
- A completed slice is demoable or verifiable on its own.
- Prefer many thin slices over few thick ones.
- Slices should be sequential and cover the PRD end-to-end when fully implemented.

## 4. Present to the user

Present the proposed breakdown as a numbered list. For each slice, show:

- Title: short descriptive name and order in the sequence.
- User stories covered: which user stories this addresses.
- Subtasks: Checkbox list of sequantial subtasks that when fully implemented cover that slice end-to-end.

## 5. Enhance the PRD

- Update the referenced PRD file using the edit tool, appending the defined slices
- Create the followind header and add all slices under it.

```md
{preceding elements of the PRD}

### Slices

{Defined slices for the PRD}
```

## 6. Slice template

```md
### {slice title} 

{A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.}

### Subtasks

{The sequential subtasks list that together implement this slice end-to-end}
```




