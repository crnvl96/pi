# ADR Format

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

Create the `docs/adr/` directory lazily, only when the first ADR is needed.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what is the context, what did we decide, and why.}
```

That is it. An ADR can be a single paragraph. The value is in recording that a decision was made and why, not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most ADRs will not need them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) - useful when decisions are revisited.
- **Considered Options** - only when the rejected alternatives are worth remembering.
- **Consequences** - only when non-obvious downstream effects need to be called out.

## Numbering

Scan `docs/adr/` for the highest existing number and increment by one.

## When to offer an ADR

All three of these must be true:

1. **Hard to reverse** - the cost of changing the decision later is meaningful.
2. **Surprising without context** - a future reader will look at the code and wonder why it works this way.
3. **The result of a real trade-off** - there were genuine alternatives and one was chosen for specific reasons.

If a decision is easy to reverse, skip it. If it is not surprising, nobody will wonder why. If there was no real alternative, there is nothing to record beyond the obvious choice.

## What qualifies

- **Architectural shape.** Example: "We are using a monorepo." Example: "The write model is event-sourced, and the read model is projected into Postgres."
- **Integration patterns between contexts.** Example: "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth provider, and deployment target can qualify. Not every library qualifies.
- **Boundary and scope decisions.** Example: "Customer data is owned by the Customer context; other contexts reference it by ID only."
- **Deliberate deviations from the obvious path.** Example: "We are using manual SQL instead of an ORM because X."
- **Constraints not visible in the code.** Example: "We cannot use AWS because of compliance requirements." Example: "Response times must be under 200ms because of the partner API contract."
- **Rejected alternatives when the rejection is non-obvious.** If you considered GraphQL and picked REST for subtle reasons, record it so someone does not suggest GraphQL again in six months.
