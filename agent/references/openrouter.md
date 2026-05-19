# OpenRouter Provider Control in Pi Coding Agent

## File Location

Edit `~/.pi/agent/models.json`. The file reloads each time you open `/model` — no restart needed.

---

## Per-Model Override

Use `modelOverrides` to customize specific built-in models without replacing the provider's full model list:

```json
{
  "providers": {
    "openrouter": {
      "modelOverrides": {
        "minimax/your-model-id": {
          "name": "MiniMax (Fireworks)",
          "compat": {
            "openRouterRouting": {
              "order": ["fireworks"],
              "allow_fallbacks": false
            }
          }
        }
      }
    }
  }
}
```

---

## References

- [OpenRouter Provider Selection Docs](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Pi models.json docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)
- [Pi OpenRouterCompat interface](https://github.com/earendil-works/pi/blob/163fd35fd8ce9d44c084b44ae2bab49b2256ae1c/packages/ai/src/types.ts#L446)
