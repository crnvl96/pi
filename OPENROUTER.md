# OpenRouter Provider Control in Pi Coding Agent

Pi supports OpenRouter provider routing via `openRouterRouting` in `models.json`. This allows you to control which underlying providers (DekalLM, Morph, Fireworks, etc.) handle your requests for models like `minimax/...`.

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

## Full `openRouterRouting` Options

| Option                     | Type                | Description                                                                                   |
| -------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `order`                    | `string[]`          | Try providers in sequence; fallbacks to others if `allow_fallbacks: true`                     |
| `only`                     | `string[]`          | Lock to specific providers only (fails if all unavailable)                                    |
| `ignore`                   | `string[]`          | Skip specific providers entirely                                                              |
| `allow_fallbacks`          | `boolean`           | Whether to allow backup providers. Default: `true`                                            |
| `require_parameters`       | `boolean`           | Only use providers that support all request parameters                                        |
| `data_collection`          | `"allow" \| "deny"` | Filter by data retention policy                                                               |
| `zdr`                      | `boolean`           | Restrict to Zero Data Retention endpoints only                                                |
| `enforce_distillable_text` | `boolean`           | Restrict to models that allow text distillation                                               |
| `quantizations`            | `string[]`          | Filter by quantization level (e.g., `["fp8", "bf16"]`)                                        |
| `sort`                     | `string \| object`  | Sort priority: `"price"`, `"throughput"`, `"latency"`, or an object with `by` and `partition` |
| `preferred_min_throughput` | `number \| object`  | Minimum throughput (tokens/sec), optionally with percentiles `p50`, `p75`, `p90`, `p99`       |
| `preferred_max_latency`    | `number \| object`  | Maximum latency (seconds), optionally with percentiles                                        |
| `max_price`                | `object`            | Hard price cap (fails if exceeded): `{ "prompt": 10, "completion": 20 }`                      |

---

## Quick Reference

| Goal                     | Config                                            |
| ------------------------ | ------------------------------------------------- |
| Force one provider       | `"only": ["fireworks"]`                           |
| Prefer one, allow others | `"order": ["fireworks"]`                          |
| No fallbacks             | `"allow_fallbacks": false`                        |
| Skip a provider          | `"ignore": ["morph"]`                             |
| Cheapest always          | `"sort": "price"`                                 |
| Fastest always           | `"sort": "throughput"`                            |
| Filter by speed          | `"preferred_max_latency": { "p90": 3 }`           |
| Hard price cap           | `"max_price": { "prompt": 10, "completion": 20 }` |

---

## Provider Slugs

Use exact provider slugs from the model's page on [openrouter.ai](https://openrouter.ai/models). Click the copy button next to provider names to get the exact slug (e.g., `fireworks`, `deepinfra/turbo`, `google-vertex/us-east5`).

- Base slug (e.g., `"deepinfra"`) matches all variants
- Full slug (e.g., `"deepinfra/turbo"`) targets a specific variant

---

## Model Shortcuts

As a shortcut, append these suffixes to any model ID in place of explicit sorting:

| Suffix   | Equivalent                                  |
| -------- | ------------------------------------------- |
| `:nitro` | `"sort": "throughput"` — highest throughput |
| `:floor` | `"sort": "price"` — lowest price            |

Example: `minimax/model-name:nitro` always routes to the fastest provider.

---

### Full Example

```json
{
  "providers": {
    "openrouter": {
      "apiKey": "OPENROUTER_API_KEY",
      "api": "openai-completions",
      "baseUrl": "https://openrouter.ai/api/v1",
      "models": [
        {
          "id": "minimax/your-model-id",
          "name": "MiniMax (Fireworks)",
          "compat": {
            "openRouterRouting": {
              "order": ["fireworks", "morph", "deepinfra"],
              "only": ["fireworks", "morph"],
              "ignore": ["some-slow-provider"],
              "allow_fallbacks": true,
              "quantizations": ["fp8", "bf16"],
              "sort": {
                "by": "price",
                "partition": "model"
              },
              "preferred_min_throughput": {
                "p50": 100,
                "p90": 50
              },
              "preferred_max_latency": {
                "p50": 1,
                "p90": 3,
                "p99": 5
              },
              "max_price": {
                "prompt": 10,
                "completion": 20
              }
            }
          }
        }
      ]
    }
  }
}
```

---

## References

- [OpenRouter Provider Selection Docs](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Pi models.json docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)
