/**
 * Todo Extension - Global todo list stored in ~/.pi/agent/todos.json.
 *
 * State is loaded once per runtime, kept in memory for fast access, and
 * persisted back to disk only when the list changes.
 */

import { StringEnum } from "@mariozechner/pi-ai";
import {
  getAgentDir,
  type ExtensionAPI,
  type Theme,
  withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type TodoAction = "list" | "add" | "toggle" | "clear";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

interface TodoFileState {
  nextId: number;
  todos: Todo[];
}

interface TodoDetails {
  action: TodoAction;
  todos?: Todo[];
  todo?: Todo;
  count?: number;
  error?: string;
}

const TodoParams = Type.Object({
  action: StringEnum(["list", "add", "toggle", "clear"] as const),
  text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
  id: Type.Optional(Type.Number({ description: "Todo ID (for toggle)" })),
});

const TODO_FILE_PATH = join(getAgentDir(), "todos.json");

function cloneTodo(todo: Todo): Todo {
  return { ...todo };
}

function cloneTodos(todos: Todo[]): Todo[] {
  return todos.map(cloneTodo);
}

function createEmptyState(): TodoFileState {
  return {
    nextId: 1,
    todos: [],
  };
}

function isNodeError(value: unknown): value is { code?: string } {
  return typeof value === "object" && value !== null && "code" in value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function normalizeState(value: unknown): TodoFileState {
  if (!value || typeof value !== "object") {
    return createEmptyState();
  }

  const input = value as {
    nextId?: unknown;
    todos?: unknown;
  };

  const todos: Todo[] = [];
  if (Array.isArray(input.todos)) {
    for (const item of input.todos) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const todo = item as {
        id?: unknown;
        text?: unknown;
        done?: unknown;
      };
      const id = typeof todo.id === "number" ? todo.id : undefined;
      const text = todo.text;
      const done = todo.done;

      if (!Number.isInteger(id) || id < 1) {
        continue;
      }
      if (typeof text !== "string") {
        continue;
      }
      if (typeof done !== "boolean") {
        continue;
      }

      todos.push({ id, text, done });
    }
  }

  const maxId = todos.reduce((currentMax, todo) => Math.max(currentMax, todo.id), 0);
  const inputNextId = typeof input.nextId === "number" ? input.nextId : undefined;
  const normalizedNextId =
    Number.isInteger(inputNextId) && inputNextId > maxId ? inputNextId : maxId + 1;

  return {
    nextId: Math.max(1, normalizedNextId),
    todos,
  };
}

async function readStateFromDisk(): Promise<TodoFileState> {
  try {
    const content = await readFile(TODO_FILE_PATH, "utf8");
    if (content.trim().length === 0) {
      return createEmptyState();
    }
    return normalizeState(JSON.parse(content));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return createEmptyState();
    }
    throw error;
  }
}

function serializeState(state: TodoFileState): string {
  return JSON.stringify({
    nextId: state.nextId,
    todos: state.todos,
  });
}

function formatTodoList(todos: Todo[]): string {
  if (todos.length === 0) {
    return "No todos";
  }

  return todos.map((todo) => `[${todo.done ? "x" : " "}] #${todo.id}: ${todo.text}`).join("\n");
}

function createErrorResult(action: TodoAction, error: string): { content: { type: "text"; text: string }[]; details: TodoDetails } {
  return {
    content: [{ type: "text", text: `Error: ${error}` }],
    details: { action, error },
  };
}

/**
 * UI component for the /todos command.
 */
class TodoListComponent {
  private todos: Todo[];
  private theme: Theme;
  private onClose: () => void;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(todos: Todo[], theme: Theme, onClose: () => void) {
    this.todos = todos;
    this.theme = theme;
    this.onClose = onClose;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const th = this.theme;

    lines.push("");
    const title = th.fg("accent", " Todos ");
    const headerLine =
      th.fg("borderMuted", "-".repeat(3)) +
      title +
      th.fg("borderMuted", "-".repeat(Math.max(0, width - 10)));
    lines.push(truncateToWidth(headerLine, width));
    lines.push("");

    if (this.todos.length === 0) {
      lines.push(
        truncateToWidth(`  ${th.fg("dim", "No todos yet. Ask the agent to add some!")}`, width),
      );
    } else {
      const done = this.todos.filter((todo) => todo.done).length;
      const total = this.todos.length;
      lines.push(truncateToWidth(`  ${th.fg("muted", `${done}/${total} completed`)}`, width));
      lines.push("");

      for (const todo of this.todos) {
        const check = todo.done ? th.fg("success", "[x]") : th.fg("dim", "[ ]");
        const id = th.fg("accent", `#${todo.id}`);
        const text = todo.done ? th.fg("dim", todo.text) : th.fg("text", todo.text);
        lines.push(truncateToWidth(`  ${check} ${id} ${text}`, width));
      }
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export default function (pi: ExtensionAPI) {
  let todos: Todo[] = [];
  let nextId = 1;
  let loadPromise: Promise<void> | undefined;
  let mutationQueue: Promise<void> = Promise.resolve();

  const ensureLoaded = async () => {
    if (!loadPromise) {
      loadPromise = (async () => {
        const state = await readStateFromDisk();
        todos = state.todos;
        nextId = state.nextId;
      })().catch((error) => {
        loadPromise = undefined;
        throw error;
      });
    }

    await loadPromise;
  };

  const persistState = async () => {
    const state: TodoFileState = {
      nextId,
      todos: cloneTodos(todos),
    };
    const serializedState = serializeState(state);

    await withFileMutationQueue(TODO_FILE_PATH, async () => {
      await mkdir(dirname(TODO_FILE_PATH), { recursive: true });
      await writeFile(TODO_FILE_PATH, serializedState, "utf8");
    });
  };

  const queueMutation = async <T>(fn: () => Promise<T>): Promise<T> => {
    await ensureLoaded();

    const run = mutationQueue.then(fn, fn);
    mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  };

  pi.on("session_start", async (_event, ctx) => {
    try {
      await ensureLoaded();
    } catch (error) {
      if (ctx.hasUI) {
        ctx.ui.notify(`Failed to load ${TODO_FILE_PATH}: ${toErrorMessage(error)}`, "error");
      }
    }
  });

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description: "Manage the global todo list. Actions: list, add (text), toggle (id), clear",
    parameters: TodoParams,

    async execute(_toolCallId, params) {
      try {
        switch (params.action) {
          case "list": {
            await ensureLoaded();
            const todoList = cloneTodos(todos);
            return {
              content: [{ type: "text", text: formatTodoList(todoList) }],
              details: { action: "list", todos: todoList } as TodoDetails,
            };
          }

          case "add": {
            if (!params.text) {
              return createErrorResult("add", "text required");
            }

            return queueMutation(async () => {
              const newTodo: Todo = { id: nextId++, text: params.text, done: false };
              todos = [...todos, newTodo];
              await persistState();
              return {
                content: [{ type: "text", text: `Added todo #${newTodo.id}: ${newTodo.text}` }],
                details: { action: "add", todo: cloneTodo(newTodo) } as TodoDetails,
              };
            });
          }

          case "toggle": {
            if (params.id === undefined) {
              return createErrorResult("toggle", "id required");
            }

            return queueMutation(async () => {
              const index = todos.findIndex((todo) => todo.id === params.id);
              if (index === -1) {
                return createErrorResult("toggle", `#${params.id} not found`);
              }

              const existingTodo = todos[index];
              if (!existingTodo) {
                return createErrorResult("toggle", `#${params.id} not found`);
              }

              const toggledTodo: Todo = {
                ...existingTodo,
                done: !existingTodo.done,
              };
              const nextTodos = [...todos];
              nextTodos[index] = toggledTodo;
              todos = nextTodos;

              await persistState();

              return {
                content: [
                  {
                    type: "text",
                    text: `Todo #${toggledTodo.id} ${toggledTodo.done ? "completed" : "uncompleted"}`,
                  },
                ],
                details: { action: "toggle", todo: cloneTodo(toggledTodo) } as TodoDetails,
              };
            });
          }

          case "clear": {
            return queueMutation(async () => {
              const count = todos.length;
              todos = [];
              nextId = 1;
              await persistState();
              return {
                content: [{ type: "text", text: `Cleared ${count} todos` }],
                details: { action: "clear", count } as TodoDetails,
              };
            });
          }

          default:
            return createErrorResult("list", `unknown action: ${params.action}`);
        }
      } catch (error) {
        try {
          const state = await readStateFromDisk();
          todos = state.todos;
          nextId = state.nextId;
          loadPromise = Promise.resolve();
        } catch {
          // Ignore reload failures here and surface the original error below.
        }

        return createErrorResult(params.action, toErrorMessage(error));
      }
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
      if (args.text) text += ` ${theme.fg("dim", `"${args.text}"`)}`;
      if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as TodoDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      if (details.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      switch (details.action) {
        case "list": {
          const todoList = details.todos ?? [];
          if (todoList.length === 0) {
            return new Text(theme.fg("dim", "No todos"), 0, 0);
          }

          let listText = theme.fg("muted", `${todoList.length} todo(s):`);
          const display = expanded ? todoList : todoList.slice(0, 5);
          for (const todo of display) {
            const check = todo.done ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
            const itemText = todo.done ? theme.fg("dim", todo.text) : theme.fg("muted", todo.text);
            listText += `\n${check} ${theme.fg("accent", `#${todo.id}`)} ${itemText}`;
          }
          if (!expanded && todoList.length > 5) {
            listText += `\n${theme.fg("dim", `... ${todoList.length - 5} more`)}`;
          }
          return new Text(listText, 0, 0);
        }

        case "add": {
          const addedTodo = details.todo;
          if (!addedTodo) {
            return new Text(theme.fg("success", "[ok] Added todo"), 0, 0);
          }

          return new Text(
            theme.fg("success", "[ok] Added ") +
              theme.fg("accent", `#${addedTodo.id}`) +
              " " +
              theme.fg("muted", addedTodo.text),
            0,
            0,
          );
        }

        case "toggle": {
          const text = result.content[0];
          const message = text?.type === "text" ? text.text : "Updated todo";
          return new Text(theme.fg("success", "[ok] ") + theme.fg("muted", message), 0, 0);
        }

        case "clear": {
          const count = details.count ?? 0;
          return new Text(
            theme.fg("success", "[ok] ") + theme.fg("muted", `Cleared ${count} todo(s)`),
            0,
            0,
          );
        }
      }
    },
  });

  pi.registerCommand("todos", {
    description: "Show the global todo list",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/todos requires interactive mode", "error");
        return;
      }

      try {
        await ensureLoaded();
      } catch (error) {
        ctx.ui.notify(`Failed to load ${TODO_FILE_PATH}: ${toErrorMessage(error)}`, "error");
        return;
      }

      const todoList = cloneTodos(todos);
      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        return new TodoListComponent(todoList, theme, () => done());
      });
    },
  });
}
