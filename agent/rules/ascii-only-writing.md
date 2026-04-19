# ASCII-only writing

Use ASCII characters only in all generated or edited text.

## Required

- Write content using only characters in the ASCII range (U+0000 to U+007F).
- Prefer `-` instead of em/en dashes.
- Prefer straight quotes (`'` and `"`) instead of curly quotes.
- Avoid symbols like ellipsis (`...` not curly ellipsis) and non-ASCII bullets.

## Examples

```text
# BAD
Service status — healthy (with em dash)
“quoted text” (with curly quotes)

# GOOD
Service status - healthy
"quoted text"
```
