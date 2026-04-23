# Refactor Candidates

After a TDD cycle, look for:

- **Duplication** -> Extract function or class
- **Long methods** -> Break into private helpers, but keep tests on the public interface
- **Shallow modules** -> Combine or deepen
- **Feature envy** -> Move logic to where the data lives
- **Primitive obsession** -> Introduce value objects
- **Existing code** that the new code reveals as problematic
