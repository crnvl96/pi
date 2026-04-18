---
name: uv
description: |
  uv integration for Python projects, scripts, tools, virtual environments, and Python version management.
  Use when running Python commands, replacing `python`/`python3`/`pip`/`venv`/`pipx` workflows, or managing dependencies in projects that use uv.
compatibility: Requires uv and jq.
---

## Common replacements

Prefer `uv run` over bare `python` or `python3` when executing Python in a project or script context.
It ensures the project environment is current and uses the right dependencies.

| Instead of                                               | Prefer                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| `python <args>`                                          | `uv run python <args>`                                          |
| `python3 <args>`                                         | `uv run python <args>` or `uv run --python 3.x python <args>`   |
| `python script.py`                                       | `uv run script.py` or `uv run python script.py`                 |
| `python -m module`                                       | `uv run python -m module`                                       |
| `python -m venv .venv`                                   | `uv venv`                                                       |
| `pip install ...`                                        | `uv pip install ...` or `uv add ...` for projects               |
| `python -c 'import package; print(package.__version__)'` | `uv run python -c 'import package; print(package.__version__)'` |
| `pip install -r requirements.txt`                        | `uv pip install -r requirements.txt`                            |
| `pipx run <tool>`                                        | `uvx <tool>` or `uv tool run <tool>`                            |
| `pipx install <tool>`                                    | `uv tool install <tool>`                                        |

## Main use cases

### Projects

Use project commands when a repository has `pyproject.toml` or `uv.lock`.

```bash
uv init                      # create a project
uv add ruff                  # add a dependency
uv remove ruff               # remove a dependency
uv sync                      # sync .venv from pyproject.toml / uv.lock
uv lock                      # update uv.lock
uv run python -m pytest      # run inside the project environment
uv tree                      # inspect project dependencies
uv export                    # export lockfile to requirements.txt / pylock.toml
uv format --check            # check Ruff formatting for the project
uv version --bump patch      # read or update the project version
uv build                     # build distributions
uv publish                   # publish distributions
```

### Scripts

Use `uv run` for standalone scripts. Declare script-only dependencies instead of manually creating environments.

```bash
uv run script.py
uv run --with rich script.py
uv init --script script.py --python 3.12
uv add --script script.py requests rich
uv remove --script script.py rich
```

Use `uv run --no-project script.py` when running a script from inside a project but it should not use the project environment.

### Tools

Use tools like `pipx` replacements for CLIs distributed as Python packages.

```bash
uvx ruff check .             # same as: uv tool run ruff check .
uv tool install ruff
uv tool list
uv tool upgrade ruff
uv tool uninstall ruff
uv tool update-shell         # add tool executables to PATH if needed
uvx --from httpie http       # when the package name and command name differ
```

### Python version management

Use uv for Python version management when a specific interpreter is needed.

```bash
uv python install 3.12
uv python list
uv python find 3.12
uv python pin 3.12
uv run --python 3.12 python --version
uv python uninstall 3.12
```

### Pip-compatible / legacy workflows

Prefer high-level project commands (`uv add`, `uv sync`, `uv run`) for uv-managed projects. Use the pip interface for existing requirements files or manual environment workflows.

```bash
uv venv
uv pip install -r requirements.txt
uv pip compile requirements.in -o requirements.txt
uv pip sync requirements.txt
uv pip list
uv pip show requests
uv pip freeze
uv pip tree
uv pip check
```

### Structured output

Use JSON output plus `jq` only for uv commands that support it; many uv commands are text-first.

```bash
uv python list --output-format json | jq '.[] | select(.path != null) | .version'
uv pip list --format json | jq '.[] | .name'
uv version --output-format json | jq '.version'
uv sync --output-format json | jq .
uv export --format cyclonedx1.5 | jq '.components[].name'
```

### Utility

Use utility commands when diagnosing uv itself rather than project dependencies.

```bash
uv cache dir
uv cache prune
uv self update
```

## Rules

- Do not replace bare Python commands when the user explicitly requests the system interpreter, a non-uv environment manager such as conda, or when `uv` is unavailable.
- Prefer `uv add` / `uv remove` over `uv pip install` / `uv pip uninstall` for dependencies in uv-managed projects.
