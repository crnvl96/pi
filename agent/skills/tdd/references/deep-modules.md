# Deep Modules

## 1. Prefer deep modules

A Deep module has a small interface with lots of implementation

```
┌─────────────────────┐
│   Small Interface   │  <- Few methods, simple params
├─────────────────────┤
│                     │
│                     │
│  Deep Implementation│  <- Complex logic hidden
│                     │
│                     │
└─────────────────────┘
```

## 2. Avoid shallow modules

A Shallow module has large interface with little implementation

```
┌─────────────────────────────────┐
│       Large Interface           │  <- Many methods, complex params
├─────────────────────────────────┤
│  Thin Implementation            │  <- Just passes through
└─────────────────────────────────┘
```

When designing interfaces, ask:

- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?
