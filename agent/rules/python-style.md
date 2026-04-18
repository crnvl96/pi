---
paths:
  - "**/*.py"
---

# Python style (cdk-ai-sales-agent)

Apply when editing or generating Python under this repository.

## Principles

- Place **imports** at the top of the module.
- **Never** add logic to `__init__.py` files (keep packages thin).
- Prefer **declarative, pure** functions; keep code simple and testable.

## Keyword arguments

Use **keyword arguments** for multi-argument calls, except:

- Single-argument builtins: `len(x)`, `str(x)`, `print(msg)`, `range(10)`, etc.
- `super().__init__(**kwargs)` as required by the superclass.

**Avoid**

```python
my_func(a, b)
```

**Prefer**

```python
my_func(
    a=a,
    b=b,
)
```

## Multi-exception handlers (PEP 758)

This project uses **Python 3.14+**. Multi-exception handlers use a **comma**, **no** parentheses (project convention).

**Avoid**

```python
except (ExcA, ExcB):
    ...
```

**Prefer**

```python
except ExcA, ExcB:
    ...
```

## Trailing commas

In multiline calls, use a **trailing comma** after the last argument so the formatter can keep one argument per line.

**Avoid**

```python
my_func(a=a, b=b, c=c)
```

**Prefer**

```python
my_func(
    a=a,
    b=b,
    c=c,
)
```
