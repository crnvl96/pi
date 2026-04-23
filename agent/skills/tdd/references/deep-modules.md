# Deep Modules

From "A Philosophy of Software Design":

A deep module has a small interface and a lot of implementation behind it.

```text
+---------------------+
|   Small Interface   |  <- Few methods, simple params
+---------------------+
|                     |
| Deep Implementation |  <- Complex logic hidden
|                     |
+---------------------+
```

A shallow module has a large interface and little implementation. Avoid these.

```text
+---------------------------------+
|         Large Interface         |  <- Many methods, complex params
+---------------------------------+
|      Thin Implementation        |  <- Just passes through
+---------------------------------+
```

When designing interfaces, ask:

- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?
