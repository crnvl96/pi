/**
 * This extension stores todo items as files under <todo-dir> (defaults to
 * ~/.pi/.pi/todos, or the path in PI_TODO_PATH). Each todo is a
 * standalone markdown file named <id>.md and an optional <id>.lock file is used
 * while a session is editing it.
 *
 * File format in <todo-dir>:
 * - The file starts with a JSON object (not YAML) containing the front matter:
 *   { id, title, status, created_at }
 * - After the JSON block comes optional markdown body text separated by a blank line.
 * - Example:
 *   {
 *     "id": "deadbeef",
 *     "title": "Add tests",
 *     "status": "open",
 *     "created_at": "2026-01-25T17:00:00.000Z"
 *   }
 *
 *   Notes about the work go here.
 *
 * Todo storage settings are kept in <todo-dir>/settings.json.
 * Defaults:
 * {
 *   "gc": true,   // delete closed todos older than gcDays on startup
 *   "gcDays": 7   // age threshold for GC (days since created_at)
 * }
 *
 * Use `/todos` to bring up the visual todo manager or just let the LLM use them
 * naturally.
 */
import {
  DynamicBorder,
  copyToClipboard,
  getMarkdownTheme,
  keyHint,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import path from "node:path";
import { homedir } from "node:os";
import fs from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import crypto from "node:crypto";
import {
  Container,
  type Focusable,
  Input,
  Key,
  Markdown,
  SelectList,
  Spacer,
  type SelectItem,
  Text,
  TUI,
  fuzzyMatch,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

const TODO_DIR_NAME = ".pi/todos";
const TODO_ROOT_DIR_NAME = path.join(".pi", TODO_DIR_NAME);
const TODO_PATH_ENV = "PI_TODO_PATH";
const TODO_SETTINGS_NAME = "settings.json";
const TODO_ID_PREFIX = "TODO-";
const TODO_ID_PATTERN = /^[a-f0-9]{8}$/i;
const DEFAULT_TODO_SETTINGS = {
  gc: true,
  gcDays: 7,
};
const LOCK_TTL_MS = 30 * 60 * 1000;

interface TodoFrontMatter {
  id: string;
  title: string;
  status: string;
  created_at: string;
  source_dir?: string;
  source_label?: string;
}

interface TodoRecord extends TodoFrontMatter {
  body: string;
}

interface LockInfo {
  id: string;
  pid: number;
  session?: string | null;
  created_at: string;
}

interface TodoSettings {
  gc: boolean;
  gcDays: number;
}

type TodoKeybindingId =
  | "tui.select.up"
  | "tui.select.down"
  | "tui.select.confirm"
  | "tui.select.cancel"
  | "tui.select.pageUp"
  | "tui.select.pageDown";

type KeybindingMatcher = {
  matches: (keyData: string, keybindingId: TodoKeybindingId) => boolean;
};

const TodoParams = Type.Object({
  action: StringEnum(["list", "list-all", "get", "create", "update", "append", "delete"] as const),
  id: Type.Optional(Type.String({ description: "Todo id (TODO-<hex> or raw hex filename)" })),
  title: Type.Optional(Type.String({ description: "Short summary shown in lists" })),
  status: Type.Optional(Type.String({ description: "Todo status" })),
  body: Type.Optional(
    Type.String({ description: "Long-form details (markdown). Update replaces; append adds." }),
  ),
});

type TodoAction = "list" | "list-all" | "get" | "create" | "update" | "append" | "delete";

type TodoOverlayAction = "back";

type TodoMenuAction =
  | "close"
  | "reopen"
  | "delete"
  | "copyPath"
  | "copyTitle"
  | "copyText"
  | "view";

type TodoToolDetails =
  | {
      action: "list" | "list-all";
      todos: TodoFrontMatter[];
      error?: string;
    }
  | {
      action: "get" | "create" | "update" | "append" | "delete";
      todo: TodoRecord;
      error?: string;
    };

function formatTodoId(id: string): string {
  return `${TODO_ID_PREFIX}${id}`;
}

function normalizeTodoId(id: string): string {
  let trimmed = id.trim();
  if (trimmed.startsWith("#")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.toUpperCase().startsWith(TODO_ID_PREFIX)) {
    trimmed = trimmed.slice(TODO_ID_PREFIX.length);
  }
  return trimmed;
}

function validateTodoId(id: string): { id: string } | { error: string } {
  const normalized = normalizeTodoId(id);
  if (!normalized || !TODO_ID_PATTERN.test(normalized)) {
    return { error: "Invalid todo id. Expected TODO-<hex>." };
  }
  return { id: normalized.toLowerCase() };
}

function displayTodoId(id: string): string {
  return formatTodoId(normalizeTodoId(id));
}

function isTodoClosed(status: string): boolean {
  return ["closed", "done"].includes(status.toLowerCase());
}

type ThemeColor = Parameters<Theme["fg"]>[0];

function renderBracketHighlightText(theme: Theme, color: ThemeColor, text: string): string {
  const regex = /\[([^\]]*)\]/g;
  let rendered = "";
  let lastIndex = 0;

  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    rendered += theme.fg(color, text.slice(lastIndex, index));
    rendered += theme.fg("success", `[${theme.bold(match[1] ?? "")}]`);
    lastIndex = index + match[0].length;
  }

  rendered += theme.fg(color, text.slice(lastIndex));
  return rendered;
}

function getTodoListStatus(todo: TodoFrontMatter): string {
  return isTodoClosed(getTodoStatus(todo)) ? "closed" : "open";
}

function sortTodos(todos: TodoFrontMatter[]): TodoFrontMatter[] {
  return [...todos].sort((a, b) => {
    const aClosed = isTodoClosed(a.status);
    const bClosed = isTodoClosed(b.status);
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    return (a.created_at || "").localeCompare(b.created_at || "");
  });
}

function buildTodoSearchText(todo: TodoFrontMatter): string {
  const source = [todo.source_label, todo.source_dir].filter(Boolean).join(" ");
  return `${formatTodoId(todo.id)} ${todo.id} ${todo.title} ${todo.status} ${source}`.trim();
}

function filterTodos(todos: TodoFrontMatter[], query: string): TodoFrontMatter[] {
  const trimmed = query.trim();
  if (!trimmed) return todos;

  const tokens = trimmed
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return todos;

  const matches: Array<{ todo: TodoFrontMatter; score: number }> = [];
  for (const todo of todos) {
    const text = buildTodoSearchText(todo);
    let totalScore = 0;
    let matched = true;
    for (const token of tokens) {
      const result = fuzzyMatch(token, text);
      if (!result.matches) {
        matched = false;
        break;
      }
      totalScore += result.score;
    }
    if (matched) {
      matches.push({ todo, score: totalScore });
    }
  }

  return matches
    .sort((a, b) => {
      const aClosed = isTodoClosed(a.todo.status);
      const bClosed = isTodoClosed(b.todo.status);
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      return a.score - b.score;
    })
    .map((match) => match.todo);
}

class TodoSelectorComponent extends Container implements Focusable {
  private searchInput: Input;
  private listContainer: Container;
  private allTodos: TodoFrontMatter[];
  private filteredTodos: TodoFrontMatter[];
  private selectedIndex = 0;
  private onSelectCallback: (todo: TodoFrontMatter) => void;
  private onCancelCallback: () => void;
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingMatcher;
  private headerText: Text;
  private hintText: Text;

  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingMatcher,
    todos: TodoFrontMatter[],
    onSelect: (todo: TodoFrontMatter) => void,
    onCancel: () => void,
    initialSearchInput?: string,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.allTodos = todos;
    this.filteredTodos = todos;
    this.onSelectCallback = onSelect;
    this.onCancelCallback = onCancel;

    this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    this.addChild(new Spacer(1));

    this.headerText = new Text("", 1, 0);
    this.addChild(this.headerText);
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    if (initialSearchInput) {
      this.searchInput.setValue(initialSearchInput);
    }
    this.searchInput.onSubmit = () => {
      const selected = this.filteredTodos[this.selectedIndex];
      if (selected) this.onSelectCallback(selected);
    };
    this.addChild(this.searchInput);

    this.addChild(new Spacer(1));
    this.listContainer = new Container();
    this.addChild(this.listContainer);

    this.addChild(new Spacer(1));
    this.hintText = new Text("", 1, 0);
    this.addChild(this.hintText);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    this.updateHeader();
    this.updateHints();
    this.applyFilter(this.searchInput.getValue());
  }

  setTodos(todos: TodoFrontMatter[]): void {
    this.allTodos = todos;
    this.updateHeader();
    this.applyFilter(this.searchInput.getValue());
    this.tui.requestRender();
  }

  getSearchValue(): string {
    return this.searchInput.getValue();
  }

  private updateHeader(): void {
    const openCount = this.allTodos.filter((todo) => !isTodoClosed(todo.status)).length;
    const closedCount = this.allTodos.length - openCount;
    const title = `Todos (${openCount} open, ${closedCount} closed)`;
    this.headerText.setText(this.theme.fg("accent", this.theme.bold(title)));
  }

  private updateHints(): void {
    this.hintText.setText(
      this.theme.fg("dim", "Type to search • ↑↓ select • Enter actions • Esc close"),
    );
  }

  private applyFilter(query: string): void {
    this.filteredTodos = filterTodos(this.allTodos, query);
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredTodos.length - 1));
    this.updateList();
  }

  private updateList(): void {
    this.listContainer.clear();

    if (this.filteredTodos.length === 0) {
      this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matching todos"), 0, 0));
      return;
    }

    const maxVisible = 10;
    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(maxVisible / 2),
        this.filteredTodos.length - maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + maxVisible, this.filteredTodos.length);

    for (let i = startIndex; i < endIndex; i += 1) {
      const todo = this.filteredTodos[i];
      if (!todo) continue;
      const isSelected = i === this.selectedIndex;
      const closed = isTodoClosed(todo.status);
      const prefix = isSelected ? "→ " : "  ";
      const statusLabel = `[${getTodoListStatus(todo)}]`;
      const title = todo.title || "(untitled)";
      const line = closed
        ? this.theme.fg("dim", `${prefix}${statusLabel} ${title}`)
        : this.theme.fg(isSelected ? "accent" : "text", prefix) +
          this.theme.fg("success", statusLabel) +
          " " +
          renderBracketHighlightText(this.theme, isSelected ? "accent" : "text", title);
      this.listContainer.addChild(new Text(line, 0, 0));
    }

    if (startIndex > 0 || endIndex < this.filteredTodos.length) {
      const scrollInfo = this.theme.fg(
        "dim",
        `  (${this.selectedIndex + 1}/${this.filteredTodos.length})`,
      );
      this.listContainer.addChild(new Text(scrollInfo, 0, 0));
    }
  }

  handleInput(keyData: string): void {
    const kb = this.keybindings;
    if (kb.matches(keyData, "tui.select.up")) {
      if (this.filteredTodos.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === 0 ? this.filteredTodos.length - 1 : this.selectedIndex - 1;
      this.updateList();
      return;
    }
    if (kb.matches(keyData, "tui.select.down")) {
      if (this.filteredTodos.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === this.filteredTodos.length - 1 ? 0 : this.selectedIndex + 1;
      this.updateList();
      return;
    }
    if (kb.matches(keyData, "tui.select.confirm")) {
      const selected = this.filteredTodos[this.selectedIndex];
      if (selected) this.onSelectCallback(selected);
      return;
    }
    if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancelCallback();
      return;
    }
    this.searchInput.handleInput(keyData);
    this.applyFilter(this.searchInput.getValue());
  }

  override invalidate(): void {
    super.invalidate();
    this.updateHeader();
    this.updateHints();
    this.updateList();
  }
}

class TodoActionMenuComponent extends Container {
  private selectList: SelectList;
  private onSelectCallback: (action: TodoMenuAction) => void;
  private onCancelCallback: () => void;

  constructor(
    theme: Theme,
    todo: TodoRecord,
    onSelect: (action: TodoMenuAction) => void,
    onCancel: () => void,
  ) {
    super();
    this.onSelectCallback = onSelect;
    this.onCancelCallback = onCancel;

    const closed = isTodoClosed(todo.status);
    const title = todo.title || "(untitled)";
    const options: SelectItem[] = [
      { value: "view", label: "view", description: "View todo" },
      ...(closed
        ? [{ value: "reopen", label: "reopen", description: "Reopen todo" }]
        : [{ value: "close", label: "close", description: "Close todo" }]),
      { value: "copyPath", label: "copy path", description: "Copy absolute path to clipboard" },
      { value: "copyTitle", label: "copy title", description: "Copy todo title to clipboard" },
      { value: "copyText", label: "copy text", description: "Copy title and body to clipboard" },
      { value: "delete", label: "delete", description: "Delete todo" },
    ];

    this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    this.addChild(new Text(theme.fg("accent", theme.bold(`Actions for "${title}"`))));

    this.selectList = new SelectList(options, options.length, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });

    this.selectList.onSelect = (item) => this.onSelectCallback(item.value as TodoMenuAction);
    this.selectList.onCancel = () => this.onCancelCallback();

    this.addChild(this.selectList);
    this.addChild(new Text(theme.fg("dim", "Enter to confirm • Esc back")));
    this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  }

  handleInput(keyData: string): void {
    this.selectList.handleInput(keyData);
  }

  override invalidate(): void {
    super.invalidate();
  }
}

class TodoDeleteConfirmComponent extends Container {
  private selectList: SelectList;
  private onConfirm: (confirmed: boolean) => void;

  constructor(theme: Theme, message: string, onConfirm: (confirmed: boolean) => void) {
    super();
    this.onConfirm = onConfirm;

    const options: SelectItem[] = [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];

    this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    this.addChild(new Text(theme.fg("accent", message)));

    this.selectList = new SelectList(options, options.length, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });

    this.selectList.onSelect = (item) => this.onConfirm(item.value === "yes");
    this.selectList.onCancel = () => this.onConfirm(false);

    this.addChild(this.selectList);
    this.addChild(new Text(theme.fg("dim", "Enter to confirm • Esc back")));
    this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
  }

  handleInput(keyData: string): void {
    this.selectList.handleInput(keyData);
  }

  override invalidate(): void {
    super.invalidate();
  }
}

class TodoDetailOverlayComponent {
  private todo: TodoRecord;
  private theme: Theme;
  private tui: TUI;
  private markdown: Markdown;
  private scrollOffset = 0;
  private viewHeight = 0;
  private totalLines = 0;
  private onAction: (action: TodoOverlayAction) => void;
  private keybindings: KeybindingMatcher;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingMatcher,
    todo: TodoRecord,
    onAction: (action: TodoOverlayAction) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.todo = todo;
    this.onAction = onAction;
    this.markdown = new Markdown(this.getMarkdownText(), 1, 0, getMarkdownTheme());
  }

  private getMarkdownText(): string {
    const body = this.todo.body?.trim();
    return body ? body : "_No details yet._";
  }

  handleInput(keyData: string): void {
    const kb = this.keybindings;
    if (kb.matches(keyData, "tui.select.cancel")) {
      this.onAction("back");
      return;
    }
    if (kb.matches(keyData, "tui.select.up")) {
      this.scrollBy(-1);
      return;
    }
    if (kb.matches(keyData, "tui.select.down")) {
      this.scrollBy(1);
      return;
    }
    if (kb.matches(keyData, "tui.select.pageUp") || matchesKey(keyData, Key.left)) {
      this.scrollBy(-this.viewHeight || -1);
      return;
    }
    if (kb.matches(keyData, "tui.select.pageDown") || matchesKey(keyData, Key.right)) {
      this.scrollBy(this.viewHeight || 1);
      return;
    }
  }

  render(width: number): string[] {
    const maxHeight = this.getMaxHeight();
    const headerLines = 3;
    const footerLines = 3;
    const borderLines = 2;
    const innerWidth = Math.max(10, width - 2);
    const contentHeight = Math.max(1, maxHeight - headerLines - footerLines - borderLines);

    const markdownLines = this.markdown.render(innerWidth);
    this.totalLines = markdownLines.length;
    this.viewHeight = contentHeight;
    const maxScroll = Math.max(0, this.totalLines - contentHeight);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));

    const visibleLines = markdownLines.slice(this.scrollOffset, this.scrollOffset + contentHeight);
    const lines: string[] = [];

    lines.push(this.buildTitleLine(innerWidth));
    lines.push(this.buildMetaLine(innerWidth));
    lines.push("");

    for (const line of visibleLines) {
      lines.push(truncateToWidth(line, innerWidth));
    }
    while (lines.length < headerLines + contentHeight) {
      lines.push("");
    }

    lines.push("");
    lines.push(this.buildActionLine(innerWidth));

    const borderColor = (text: string) => this.theme.fg("borderMuted", text);
    const top = borderColor(`┌${"─".repeat(innerWidth)}┐`);
    const bottom = borderColor(`└${"─".repeat(innerWidth)}┘`);
    const framedLines = lines.map((line) => {
      const truncated = truncateToWidth(line, innerWidth);
      const padding = Math.max(0, innerWidth - visibleWidth(truncated));
      return borderColor("│") + truncated + " ".repeat(padding) + borderColor("│");
    });

    return [top, ...framedLines, bottom].map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {
    this.markdown = new Markdown(this.getMarkdownText(), 1, 0, getMarkdownTheme());
  }

  private getMaxHeight(): number {
    const rows = this.tui.terminal.rows || 24;
    return Math.max(10, Math.floor(rows * 0.8));
  }

  private buildTitleLine(width: number): string {
    const titleText = this.todo.title ? ` ${this.todo.title} ` : " Todo ";
    const titleWidth = visibleWidth(titleText);
    if (titleWidth >= width) {
      return truncateToWidth(this.theme.fg("accent", titleText.trim()), width);
    }
    const leftWidth = Math.max(0, Math.floor((width - titleWidth) / 2));
    const rightWidth = Math.max(0, width - titleWidth - leftWidth);
    return (
      this.theme.fg("borderMuted", "─".repeat(leftWidth)) +
      this.theme.fg("accent", titleText) +
      this.theme.fg("borderMuted", "─".repeat(rightWidth))
    );
  }

  private buildMetaLine(width: number): string {
    const status = this.todo.status || "open";
    const statusColor = isTodoClosed(status) ? "dim" : "success";
    return truncateToWidth(this.theme.fg(statusColor, status), width);
  }

  private buildActionLine(width: number): string {
    const back = this.theme.fg("dim", "esc back");
    const nav = this.theme.fg("dim", "↑/↓: move. ←/→: page.");
    const pieces = [back, nav];

    let line = pieces.join(this.theme.fg("muted", " • "));
    if (this.totalLines > this.viewHeight) {
      const start = Math.min(this.totalLines, this.scrollOffset + 1);
      const end = Math.min(this.totalLines, this.scrollOffset + this.viewHeight);
      const scrollInfo = this.theme.fg("dim", ` ${start}-${end}/${this.totalLines}`);
      line += scrollInfo;
    }

    return truncateToWidth(line, width);
  }

  private scrollBy(delta: number): void {
    const maxScroll = Math.max(0, this.totalLines - this.viewHeight);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset + delta, maxScroll));
  }
}

function getDefaultTodosRoot(): string {
  return path.join(homedir(), TODO_ROOT_DIR_NAME);
}

function getTodosDir(cwd: string): string {
  const overridePath = process.env[TODO_PATH_ENV];
  if (overridePath && overridePath.trim()) {
    return path.resolve(cwd, overridePath.trim());
  }
  return getDefaultTodosRoot();
}

function getTodosDirLabel(cwd: string): string {
  const overridePath = process.env[TODO_PATH_ENV];
  if (overridePath && overridePath.trim()) {
    return path.resolve(cwd, overridePath.trim());
  }
  return path.join("~", TODO_ROOT_DIR_NAME);
}

function getTodoSourceLabel(todosDir: string): string {
  const defaultRoot = getDefaultTodosRoot();
  const relative = path.relative(defaultRoot, todosDir);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep)[0] || relative;
  }
  const home = homedir();
  if (todosDir === home || todosDir.startsWith(`${home}${path.sep}`)) {
    return path.join("~", path.relative(home, todosDir));
  }
  return todosDir;
}

async function listTodoDirectories(cwd: string): Promise<string[]> {
  const currentTodosDir = getTodosDir(cwd);
  return [currentTodosDir];
}

async function findTodosDirForId(cwd: string, id: string): Promise<string | null> {
  const currentTodosDir = getTodosDir(cwd);
  if (existsSync(getTodoPath(currentTodosDir, id))) {
    return currentTodosDir;
  }

  const dirs = await listTodoDirectories(cwd);
  for (const todosDir of dirs) {
    if (todosDir === currentTodosDir) continue;
    if (existsSync(getTodoPath(todosDir, id))) {
      return todosDir;
    }
  }

  return null;
}

function getTodoSourceDir(todo: TodoFrontMatter, fallbackTodosDir: string): string {
  return todo.source_dir || fallbackTodosDir;
}

function attachTodoSource<T extends TodoFrontMatter>(todo: T, todosDir: string): T {
  todo.source_dir = todosDir;
  todo.source_label = getTodoSourceLabel(todosDir);
  return todo;
}

function getTodoSettingsPath(todosDir: string): string {
  return path.join(todosDir, TODO_SETTINGS_NAME);
}

function normalizeTodoSettings(raw: Partial<TodoSettings>): TodoSettings {
  const gc = raw.gc ?? DEFAULT_TODO_SETTINGS.gc;
  const gcDays =
    typeof raw.gcDays === "number" && Number.isFinite(raw.gcDays)
      ? raw.gcDays
      : DEFAULT_TODO_SETTINGS.gcDays;
  return {
    gc: Boolean(gc),
    gcDays: Math.max(0, Math.floor(gcDays)),
  };
}

async function readTodoSettings(todosDir: string): Promise<TodoSettings> {
  const settingsPath = getTodoSettingsPath(todosDir);
  let data: Partial<TodoSettings> = {};

  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    data = JSON.parse(raw) as Partial<TodoSettings>;
  } catch {
    data = {};
  }

  return normalizeTodoSettings(data);
}

async function listTodoMarkdownFiles(rootDir: string): Promise<string[]> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listTodoMarkdownFiles(entryPath)));
        return;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(entryPath);
      }
    }),
  );
  return files;
}

async function garbageCollectTodos(todosRootDir: string, settings: TodoSettings): Promise<void> {
  if (!settings.gc) return;

  const files = await listTodoMarkdownFiles(todosRootDir);
  if (!files.length) {
    return;
  }

  const cutoff = Date.now() - settings.gcDays * 24 * 60 * 60 * 1000;
  await Promise.all(
    files.map(async (filePath) => {
      const id = path.basename(filePath, ".md");
      try {
        const content = await fs.readFile(filePath, "utf8");
        const { frontMatter } = splitFrontMatter(content);
        const parsed = parseFrontMatter(frontMatter, id);
        if (!isTodoClosed(parsed.status)) return;
        const createdAt = Date.parse(parsed.created_at);
        if (!Number.isFinite(createdAt)) return;
        if (createdAt < cutoff) {
          await fs.unlink(filePath);
        }
      } catch {
        // ignore unreadable todo
      }
    }),
  );
}

function getTodoPath(todosDir: string, id: string): string {
  return path.join(todosDir, `${id}.md`);
}

function getLockPath(todosDir: string, id: string): string {
  return path.join(todosDir, `${id}.lock`);
}

function parseFrontMatter(text: string, idFallback: string): TodoFrontMatter {
  const data: TodoFrontMatter = {
    id: idFallback,
    title: "",
    status: "open",
    created_at: "",
  };

  const trimmed = text.trim();
  if (!trimmed) return data;

  try {
    const parsed = JSON.parse(trimmed) as Partial<TodoFrontMatter> | null;
    if (!parsed || typeof parsed !== "object") return data;
    if (typeof parsed.id === "string" && parsed.id) data.id = parsed.id;
    if (typeof parsed.title === "string") data.title = parsed.title;
    if (typeof parsed.status === "string" && parsed.status) data.status = parsed.status;
    if (typeof parsed.created_at === "string") data.created_at = parsed.created_at;
  } catch {
    return data;
  }

  return data;
}

function findJsonObjectEnd(content: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function splitFrontMatter(content: string): { frontMatter: string; body: string } {
  if (!content.startsWith("{")) {
    return { frontMatter: "", body: content };
  }

  const endIndex = findJsonObjectEnd(content);
  if (endIndex === -1) {
    return { frontMatter: "", body: content };
  }

  const frontMatter = content.slice(0, endIndex + 1);
  const body = content.slice(endIndex + 1).replace(/^\r?\n+/, "");
  return { frontMatter, body };
}

function parseTodoContent(content: string, idFallback: string): TodoRecord {
  const { frontMatter, body } = splitFrontMatter(content);
  const parsed = parseFrontMatter(frontMatter, idFallback);
  return {
    id: idFallback,
    title: parsed.title,
    status: parsed.status,
    created_at: parsed.created_at,
    body: body ?? "",
  };
}

function serializeTodo(todo: TodoRecord): string {
  const frontMatter = JSON.stringify(
    {
      id: todo.id,
      title: todo.title,
      status: todo.status,
      created_at: todo.created_at,
    },
    null,
    2,
  );

  const body = todo.body ?? "";
  const trimmedBody = body.replace(/^\n+/, "").replace(/\s+$/, "");
  if (!trimmedBody) return `${frontMatter}\n`;
  return `${frontMatter}\n\n${trimmedBody}\n`;
}

async function ensureTodosDir(todosDir: string) {
  await fs.mkdir(todosDir, { recursive: true });
}

async function readTodoFile(filePath: string, idFallback: string): Promise<TodoRecord> {
  const content = await fs.readFile(filePath, "utf8");
  return parseTodoContent(content, idFallback);
}

async function writeTodoFile(filePath: string, todo: TodoRecord) {
  await fs.writeFile(filePath, serializeTodo(todo), "utf8");
}

async function generateTodoId(todosDir: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = crypto.randomBytes(4).toString("hex");
    const todoPath = getTodoPath(todosDir, id);
    if (!existsSync(todoPath)) return id;
  }
  throw new Error("Failed to generate unique todo id");
}

async function readLockInfo(lockPath: string): Promise<LockInfo | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    return JSON.parse(raw) as LockInfo;
  } catch {
    return null;
  }
}

async function acquireLock(
  todosDir: string,
  id: string,
  ctx: ExtensionContext,
): Promise<(() => Promise<void>) | { error: string }> {
  const lockPath = getLockPath(todosDir, id);
  const now = Date.now();
  const session = ctx.sessionManager.getSessionFile();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      const info: LockInfo = {
        id,
        pid: process.pid,
        session,
        created_at: new Date(now).toISOString(),
      };
      await handle.writeFile(JSON.stringify(info, null, 2), "utf8");
      await handle.close();
      return async () => {
        try {
          await fs.unlink(lockPath);
        } catch {
          // ignore
        }
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") {
        return { error: `Failed to acquire lock: ${error?.message ?? "unknown error"}` };
      }
      const stats = await fs.stat(lockPath).catch(() => null);
      const lockAge = stats ? now - stats.mtimeMs : LOCK_TTL_MS + 1;
      if (lockAge <= LOCK_TTL_MS) {
        const info = await readLockInfo(lockPath);
        const owner = info?.session ? ` (session ${info.session})` : "";
        return { error: `Todo ${displayTodoId(id)} is locked${owner}. Try again later.` };
      }
      if (!ctx.hasUI) {
        return {
          error: `Todo ${displayTodoId(id)} lock is stale; rerun in interactive mode to steal it.`,
        };
      }
      const ok = await ctx.ui.confirm(
        "Todo locked",
        `Todo ${displayTodoId(id)} appears locked. Steal the lock?`,
      );
      if (!ok) {
        return { error: `Todo ${displayTodoId(id)} remains locked.` };
      }
      await fs.unlink(lockPath).catch(() => undefined);
    }
  }

  return { error: `Failed to acquire lock for todo ${displayTodoId(id)}.` };
}

async function withTodoLock<T>(
  todosDir: string,
  id: string,
  ctx: ExtensionContext,
  fn: () => Promise<T>,
): Promise<T | { error: string }> {
  const lock = await acquireLock(todosDir, id, ctx);
  if (typeof lock === "object" && "error" in lock) return lock;
  try {
    return await fn();
  } finally {
    await lock();
  }
}

async function listTodos(todosDir: string): Promise<TodoFrontMatter[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(todosDir);
  } catch {
    return [];
  }

  const todos: TodoFrontMatter[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const id = entry.slice(0, -3);
    const filePath = path.join(todosDir, entry);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const { frontMatter } = splitFrontMatter(content);
      const parsed = parseFrontMatter(frontMatter, id);
      todos.push({
        id,
        title: parsed.title,
        status: parsed.status,
        created_at: parsed.created_at,
        source_dir: todosDir,
        source_label: getTodoSourceLabel(todosDir),
      });
    } catch {
      // ignore unreadable todo
    }
  }

  return sortTodos(todos);
}

async function listTodosFromAllFolders(cwd: string): Promise<TodoFrontMatter[]> {
  const dirs = await listTodoDirectories(cwd);
  const allTodos = (await Promise.all(dirs.map((todosDir) => listTodos(todosDir)))).flat();
  return sortTodos(allTodos);
}

function listTodosSync(todosDir: string): TodoFrontMatter[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(todosDir);
  } catch {
    return [];
  }

  const todos: TodoFrontMatter[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const id = entry.slice(0, -3);
    const filePath = path.join(todosDir, entry);
    try {
      const content = readFileSync(filePath, "utf8");
      const { frontMatter } = splitFrontMatter(content);
      const parsed = parseFrontMatter(frontMatter, id);
      todos.push({
        id,
        title: parsed.title,
        status: parsed.status,
        created_at: parsed.created_at,
        source_dir: todosDir,
        source_label: getTodoSourceLabel(todosDir),
      });
    } catch {
      // ignore
    }
  }

  return sortTodos(todos);
}

function getTodoTitle(todo: TodoFrontMatter): string {
  return todo.title || "(untitled)";
}

function getTodoStatus(todo: TodoFrontMatter): string {
  return todo.status || "open";
}

function formatTodoHeading(todo: TodoFrontMatter): string {
  return `[${getTodoListStatus(todo)}] ${getTodoTitle(todo)}`;
}

function splitTodosByStatus(todos: TodoFrontMatter[]): {
  openTodos: TodoFrontMatter[];
  closedTodos: TodoFrontMatter[];
} {
  const openTodos: TodoFrontMatter[] = [];
  const closedTodos: TodoFrontMatter[] = [];
  for (const todo of todos) {
    if (isTodoClosed(getTodoStatus(todo))) {
      closedTodos.push(todo);
      continue;
    }
    openTodos.push(todo);
  }
  return { openTodos, closedTodos };
}

function formatTodoList(todos: TodoFrontMatter[]): string {
  if (!todos.length) return "No todos.";

  const { openTodos, closedTodos } = splitTodosByStatus(todos);
  const lines: string[] = [];
  const pushSection = (label: string, sectionTodos: TodoFrontMatter[]) => {
    lines.push(`${label} (${sectionTodos.length}):`);
    if (!sectionTodos.length) {
      lines.push("  none");
      return;
    }
    for (const todo of sectionTodos) {
      lines.push(`  ${formatTodoHeading(todo)}`);
    }
  };

  pushSection("Open todos", openTodos);
  pushSection("Closed todos", closedTodos);
  return lines.join("\n");
}

function serializeTodoForAgent(todo: TodoRecord): string {
  const payload = { ...todo, id: formatTodoId(todo.id) };
  return JSON.stringify(payload, null, 2);
}

function serializeTodoListForAgent(todos: TodoFrontMatter[]): string {
  const { openTodos, closedTodos } = splitTodosByStatus(todos);
  const mapTodo = (todo: TodoFrontMatter) => ({ ...todo, id: formatTodoId(todo.id) });
  return JSON.stringify(
    {
      open: openTodos.map(mapTodo),
      closed: closedTodos.map(mapTodo),
    },
    null,
    2,
  );
}

function renderTodoHeading(theme: Theme, todo: TodoFrontMatter): string {
  const closed = isTodoClosed(getTodoStatus(todo));
  const statusLabel = `[${getTodoListStatus(todo)}]`;
  const title = getTodoTitle(todo);
  if (closed) {
    return theme.fg("dim", `${statusLabel} ${title}`);
  }
  return theme.fg("success", statusLabel) + " " + renderBracketHighlightText(theme, "text", title);
}

function renderTodoList(theme: Theme, todos: TodoFrontMatter[], expanded: boolean): string {
  if (!todos.length) return theme.fg("dim", "No todos");

  const { openTodos, closedTodos } = splitTodosByStatus(todos);
  const lines: string[] = [];
  const pushSection = (label: string, sectionTodos: TodoFrontMatter[]) => {
    lines.push(theme.fg("muted", `${label} (${sectionTodos.length})`));
    if (!sectionTodos.length) {
      lines.push(theme.fg("dim", "  none"));
      return;
    }
    const maxItems = expanded ? sectionTodos.length : Math.min(sectionTodos.length, 3);
    for (let i = 0; i < maxItems; i++) {
      lines.push(`  ${renderTodoHeading(theme, sectionTodos[i])}`);
    }
    if (!expanded && sectionTodos.length > maxItems) {
      lines.push(theme.fg("dim", `  ... ${sectionTodos.length - maxItems} more`));
    }
  };

  const sections: Array<{ label: string; todos: TodoFrontMatter[] }> = [
    { label: "Open todos", todos: openTodos },
    { label: "Closed todos", todos: closedTodos },
  ];

  sections.forEach((section, index) => {
    if (index > 0) lines.push("");
    pushSection(section.label, section.todos);
  });

  return lines.join("\n");
}

function renderTodoDetail(theme: Theme, todo: TodoRecord, expanded: boolean): string {
  const summary = renderTodoHeading(theme, todo);
  if (!expanded) return summary;

  const createdAt = todo.created_at || "unknown";
  const bodyText = todo.body?.trim() ? todo.body.trim() : "No details yet.";
  const bodyLines = bodyText.split("\n");

  const lines = [
    summary,
    theme.fg("muted", `Status: ${getTodoStatus(todo)}`),
    theme.fg("muted", `Created: ${createdAt}`),
    "",
    theme.fg("muted", "Body:"),
    ...bodyLines.map((line) => theme.fg("text", `  ${line}`)),
  ];

  return lines.join("\n");
}

function appendExpandHint(theme: Theme, text: string): string {
  return `${text}\n${theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`)}`;
}

async function ensureTodoExists(filePath: string, id: string): Promise<TodoRecord | null> {
  if (!existsSync(filePath)) return null;
  return readTodoFile(filePath, id);
}

async function appendTodoBody(
  filePath: string,
  todo: TodoRecord,
  text: string,
): Promise<TodoRecord> {
  const spacer = todo.body.trim().length ? "\n\n" : "";
  todo.body = `${todo.body.replace(/\s+$/, "")}${spacer}${text.trim()}\n`;
  await writeTodoFile(filePath, todo);
  return todo;
}

async function updateTodoStatus(
  todosDir: string,
  id: string,
  status: string,
  ctx: ExtensionContext,
): Promise<TodoRecord | { error: string }> {
  const validated = validateTodoId(id);
  if ("error" in validated) {
    return { error: validated.error };
  }
  const normalizedId = validated.id;
  const filePath = getTodoPath(todosDir, normalizedId);
  if (!existsSync(filePath)) {
    return { error: `Todo ${displayTodoId(id)} not found` };
  }

  const result = await withTodoLock(todosDir, normalizedId, ctx, async () => {
    const existing = await ensureTodoExists(filePath, normalizedId);
    if (!existing) return { error: `Todo ${displayTodoId(id)} not found` } as const;
    existing.status = status;
    await writeTodoFile(filePath, existing);
    return existing;
  });

  if (typeof result === "object" && "error" in result) {
    return { error: result.error };
  }

  return result;
}

async function deleteTodo(
  todosDir: string,
  id: string,
  ctx: ExtensionContext,
): Promise<TodoRecord | { error: string }> {
  const validated = validateTodoId(id);
  if ("error" in validated) {
    return { error: validated.error };
  }
  const normalizedId = validated.id;
  const filePath = getTodoPath(todosDir, normalizedId);
  if (!existsSync(filePath)) {
    return { error: `Todo ${displayTodoId(id)} not found` };
  }

  const result = await withTodoLock(todosDir, normalizedId, ctx, async () => {
    const existing = await ensureTodoExists(filePath, normalizedId);
    if (!existing) return { error: `Todo ${displayTodoId(id)} not found` } as const;
    await fs.unlink(filePath);
    return existing;
  });

  if (typeof result === "object" && "error" in result) {
    return { error: result.error };
  }

  return result;
}

export default function todosExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const todosDir = getTodosDir(ctx.cwd);
    await ensureTodosDir(todosDir);
    const settings = await readTodoSettings(todosDir);
    const gcRootDir = process.env[TODO_PATH_ENV]?.trim() ? todosDir : getDefaultTodosRoot();
    await garbageCollectTodos(gcRootDir, settings);
  });

  const todosDirLabel = getTodosDirLabel(process.cwd());

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description:
      `Manage file-based todos in ${todosDirLabel} (list, list-all, get, create, update, append, delete). ` +
      "Title is the short summary; body is long-form markdown notes (update replaces, append adds). " +
      "Todo ids are shown as TODO-<hex>; id parameters accept TODO-<hex> or the raw hex filename. " +
      "Close todos when complete.",
    parameters: TodoParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const todosDir = getTodosDir(ctx.cwd);
      const action: TodoAction = params.action;

      switch (action) {
        case "list": {
          const todos = await listTodosFromAllFolders(ctx.cwd);
          const { openTodos } = splitTodosByStatus(todos);
          const listedTodos = openTodos;
          return {
            content: [{ type: "text", text: serializeTodoListForAgent(listedTodos) }],
            details: { action: "list", todos: listedTodos },
          };
        }

        case "list-all": {
          const todos = await listTodosFromAllFolders(ctx.cwd);
          return {
            content: [{ type: "text", text: serializeTodoListForAgent(todos) }],
            details: { action: "list-all", todos },
          };
        }

        case "get": {
          if (!params.id) {
            return {
              content: [{ type: "text", text: "Error: id required" }],
              details: { action: "get", error: "id required" },
            };
          }
          const validated = validateTodoId(params.id);
          if ("error" in validated) {
            return {
              content: [{ type: "text", text: validated.error }],
              details: { action: "get", error: validated.error },
            };
          }
          const normalizedId = validated.id;
          const displayId = formatTodoId(normalizedId);
          const targetTodosDir = await findTodosDirForId(ctx.cwd, normalizedId);
          const filePath = targetTodosDir ? getTodoPath(targetTodosDir, normalizedId) : "";
          const todo = await ensureTodoExists(filePath, normalizedId);
          if (!todo) {
            return {
              content: [{ type: "text", text: `Todo ${displayId} not found` }],
              details: { action: "get", error: "not found" },
            };
          }
          attachTodoSource(todo, targetTodosDir ?? todosDir);
          return {
            content: [{ type: "text", text: serializeTodoForAgent(todo) }],
            details: { action: "get", todo },
          };
        }

        case "create": {
          if (!params.title) {
            return {
              content: [{ type: "text", text: "Error: title required" }],
              details: { action: "create", error: "title required" },
            };
          }
          await ensureTodosDir(todosDir);
          const id = await generateTodoId(todosDir);
          const filePath = getTodoPath(todosDir, id);
          const todo: TodoRecord = {
            id,
            title: params.title,
            status: params.status ?? "open",
            created_at: new Date().toISOString(),
            body: params.body ?? "",
          };
          attachTodoSource(todo, todosDir);

          const result = await withTodoLock(todosDir, id, ctx, async () => {
            await writeTodoFile(filePath, todo);
            return todo;
          });

          if (typeof result === "object" && "error" in result) {
            return {
              content: [{ type: "text", text: result.error }],
              details: { action: "create", error: result.error },
            };
          }

          return {
            content: [{ type: "text", text: serializeTodoForAgent(todo) }],
            details: { action: "create", todo },
          };
        }

        case "update": {
          if (!params.id) {
            return {
              content: [{ type: "text", text: "Error: id required" }],
              details: { action: "update", error: "id required" },
            };
          }
          const validated = validateTodoId(params.id);
          if ("error" in validated) {
            return {
              content: [{ type: "text", text: validated.error }],
              details: { action: "update", error: validated.error },
            };
          }
          const normalizedId = validated.id;
          const displayId = formatTodoId(normalizedId);
          const targetTodosDir = await findTodosDirForId(ctx.cwd, normalizedId);
          const filePath = targetTodosDir ? getTodoPath(targetTodosDir, normalizedId) : "";
          if (!existsSync(filePath)) {
            return {
              content: [{ type: "text", text: `Todo ${displayId} not found` }],
              details: { action: "update", error: "not found" },
            };
          }
          const result = await withTodoLock(
            targetTodosDir ?? todosDir,
            normalizedId,
            ctx,
            async () => {
              const existing = await ensureTodoExists(filePath, normalizedId);
              if (!existing) return { error: `Todo ${displayId} not found` } as const;

              existing.id = normalizedId;
              if (params.title !== undefined) existing.title = params.title;
              if (params.status !== undefined) existing.status = params.status;
              if (params.body !== undefined) existing.body = params.body;
              if (!existing.created_at) existing.created_at = new Date().toISOString();

              await writeTodoFile(filePath, existing);
              return existing;
            },
          );

          if (typeof result === "object" && "error" in result) {
            return {
              content: [{ type: "text", text: result.error }],
              details: { action: "update", error: result.error },
            };
          }

          const updatedTodo = result as TodoRecord;
          attachTodoSource(updatedTodo, targetTodosDir ?? todosDir);
          return {
            content: [{ type: "text", text: serializeTodoForAgent(updatedTodo) }],
            details: { action: "update", todo: updatedTodo },
          };
        }

        case "append": {
          if (!params.id) {
            return {
              content: [{ type: "text", text: "Error: id required" }],
              details: { action: "append", error: "id required" },
            };
          }
          const validated = validateTodoId(params.id);
          if ("error" in validated) {
            return {
              content: [{ type: "text", text: validated.error }],
              details: { action: "append", error: validated.error },
            };
          }
          const normalizedId = validated.id;
          const displayId = formatTodoId(normalizedId);
          const targetTodosDir = await findTodosDirForId(ctx.cwd, normalizedId);
          const filePath = targetTodosDir ? getTodoPath(targetTodosDir, normalizedId) : "";
          if (!existsSync(filePath)) {
            return {
              content: [{ type: "text", text: `Todo ${displayId} not found` }],
              details: { action: "append", error: "not found" },
            };
          }
          const result = await withTodoLock(
            targetTodosDir ?? todosDir,
            normalizedId,
            ctx,
            async () => {
              const existing = await ensureTodoExists(filePath, normalizedId);
              if (!existing) return { error: `Todo ${displayId} not found` } as const;
              if (!params.body || !params.body.trim()) {
                return existing;
              }
              const updated = await appendTodoBody(filePath, existing, params.body);
              return updated;
            },
          );

          if (typeof result === "object" && "error" in result) {
            return {
              content: [{ type: "text", text: result.error }],
              details: { action: "append", error: result.error },
            };
          }

          const updatedTodo = result as TodoRecord;
          attachTodoSource(updatedTodo, targetTodosDir ?? todosDir);
          return {
            content: [{ type: "text", text: serializeTodoForAgent(updatedTodo) }],
            details: { action: "append", todo: updatedTodo },
          };
        }

        case "delete": {
          if (!params.id) {
            return {
              content: [{ type: "text", text: "Error: id required" }],
              details: { action: "delete", error: "id required" },
            };
          }

          const validated = validateTodoId(params.id);
          if ("error" in validated) {
            return {
              content: [{ type: "text", text: validated.error }],
              details: { action: "delete", error: validated.error },
            };
          }
          const targetTodosDir = await findTodosDirForId(ctx.cwd, validated.id);
          if (!targetTodosDir) {
            return {
              content: [{ type: "text", text: `Todo ${formatTodoId(validated.id)} not found` }],
              details: { action: "delete", error: "not found" },
            };
          }
          const result = await deleteTodo(targetTodosDir, validated.id, ctx);
          if (typeof result === "object" && "error" in result) {
            return {
              content: [{ type: "text", text: result.error }],
              details: { action: "delete", error: result.error },
            };
          }

          attachTodoSource(result as TodoRecord, targetTodosDir);

          return {
            content: [{ type: "text", text: serializeTodoForAgent(result as TodoRecord) }],
            details: { action: "delete", todo: result as TodoRecord },
          };
        }
      }
    },

    renderCall(args, theme) {
      const action = typeof args.action === "string" ? args.action : "";
      const title = typeof args.title === "string" ? args.title : "";
      let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", action);
      if (title) {
        text += " " + theme.fg("dim", `"${title}"`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as TodoToolDetails | undefined;
      if (isPartial) {
        return new Text(theme.fg("warning", "Processing..."), 0, 0);
      }
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      if (details.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      if (details.action === "list" || details.action === "list-all") {
        let text = renderTodoList(theme, details.todos, expanded);
        if (!expanded) {
          const { closedTodos } = splitTodosByStatus(details.todos);
          if (closedTodos.length) {
            text = appendExpandHint(theme, text);
          }
        }
        return new Text(text, 0, 0);
      }

      if (!("todo" in details)) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      let text = renderTodoDetail(theme, details.todo, expanded);
      const actionLabel =
        details.action === "create"
          ? "Created"
          : details.action === "update"
            ? "Updated"
            : details.action === "append"
              ? "Appended to"
              : details.action === "delete"
                ? "Deleted"
                : null;
      if (actionLabel) {
        const lines = text.split("\n");
        lines[0] = theme.fg("success", "✓ ") + theme.fg("muted", `${actionLabel} `) + lines[0];
        text = lines.join("\n");
      }
      if (!expanded) {
        text = appendExpandHint(theme, text);
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerCommand("todos", {
    description: `List todos from ${todosDirLabel}`,
    handler: async (args, ctx) => {
      const todosDir = getTodosDir(ctx.cwd);
      const todos = await listTodosFromAllFolders(ctx.cwd);
      const searchTerm = (args ?? "").trim();

      if (!ctx.hasUI) {
        const text = formatTodoList(todos);
        console.log(text);
        return;
      }

      await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
        let selector: TodoSelectorComponent | null = null;
        let actionMenu: TodoActionMenuComponent | null = null;
        let deleteConfirm: TodoDeleteConfirmComponent | null = null;
        let activeComponent: {
          render: (width: number) => string[];
          invalidate: () => void;
          handleInput?: (data: string) => void;
          focused?: boolean;
        } | null = null;
        let wrapperFocused = false;

        const setActiveComponent = (
          component: {
            render: (width: number) => string[];
            invalidate: () => void;
            handleInput?: (data: string) => void;
            focused?: boolean;
          } | null,
        ) => {
          if (activeComponent && "focused" in activeComponent) {
            activeComponent.focused = false;
          }
          activeComponent = component;
          if (activeComponent && "focused" in activeComponent) {
            activeComponent.focused = wrapperFocused;
          }
          tui.requestRender();
        };

        const copyTodoPathToClipboard = (todo: TodoFrontMatter) => {
          const todoDir = getTodoSourceDir(todo, todosDir);
          const filePath = getTodoPath(todoDir, todo.id);
          const absolutePath = path.resolve(filePath);
          try {
            copyToClipboard(absolutePath);
            ctx.ui.notify(`Copied ${absolutePath} to clipboard`, "info");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(message, "error");
          }
        };

        const copyTodoTextToClipboard = (record: TodoRecord) => {
          const title = record.title || "(untitled)";
          const body = record.body?.trim() || "";
          const text = body ? `# ${title}\n\n${body}` : `# ${title}`;
          try {
            copyToClipboard(text);
            ctx.ui.notify("Copied todo text to clipboard", "info");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(message, "error");
          }
        };

        const copyTodoTitleToClipboard = (record: TodoRecord) => {
          const title = record.title || "(untitled)";
          try {
            copyToClipboard(title);
            ctx.ui.notify("Copied todo title to clipboard", "info");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(message, "error");
          }
        };

        const resolveTodoRecord = async (todo: TodoFrontMatter): Promise<TodoRecord | null> => {
          const todoDir = getTodoSourceDir(todo, todosDir);
          const filePath = getTodoPath(todoDir, todo.id);
          const record = await ensureTodoExists(filePath, todo.id);
          if (!record) {
            ctx.ui.notify("Todo not found", "error");
            return null;
          }
          attachTodoSource(record, todoDir);
          return record;
        };

        const openTodoOverlay = async (record: TodoRecord): Promise<TodoOverlayAction> => {
          const action = await ctx.ui.custom<TodoOverlayAction>(
            (overlayTui, overlayTheme, overlayKeybindings, overlayDone) =>
              new TodoDetailOverlayComponent(
                overlayTui,
                overlayTheme,
                overlayKeybindings,
                record,
                overlayDone,
              ),
            {
              overlay: true,
              overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" },
            },
          );

          return action ?? "back";
        };

        const applyTodoAction = async (
          record: TodoRecord,
          action: TodoMenuAction,
        ): Promise<"stay"> => {
          if (action === "view") {
            return "stay";
          }
          if (action === "copyPath") {
            copyTodoPathToClipboard(record);
            return "stay";
          }
          if (action === "copyTitle") {
            copyTodoTitleToClipboard(record);
            return "stay";
          }
          if (action === "copyText") {
            copyTodoTextToClipboard(record);
            return "stay";
          }

          if (action === "delete") {
            const todoDir = getTodoSourceDir(record, todosDir);
            const result = await deleteTodo(todoDir, record.id, ctx);
            if ("error" in result) {
              ctx.ui.notify(result.error, "error");
              return "stay";
            }
            const updatedTodos = await listTodosFromAllFolders(ctx.cwd);
            selector?.setTodos(updatedTodos);
            ctx.ui.notify(`Deleted todo "${record.title || "(untitled)"}"`, "info");
            return "stay";
          }

          const nextStatus = action === "close" ? "closed" : "open";
          const todoDir = getTodoSourceDir(record, todosDir);
          const result = await updateTodoStatus(todoDir, record.id, nextStatus, ctx);
          if ("error" in result) {
            ctx.ui.notify(result.error, "error");
            return "stay";
          }

          const updatedTodos = await listTodosFromAllFolders(ctx.cwd);
          selector?.setTodos(updatedTodos);
          ctx.ui.notify(
            `${action === "close" ? "Closed" : "Reopened"} todo "${record.title || "(untitled)"}"`,
            "info",
          );
          return "stay";
        };

        const handleActionSelection = async (record: TodoRecord, action: TodoMenuAction) => {
          if (action === "view") {
            await openTodoOverlay(record);
            if (actionMenu) {
              setActiveComponent(actionMenu);
            }
            return;
          }

          if (action === "delete") {
            const message = `Delete todo "${record.title || "(untitled)"}"? This cannot be undone.`;
            deleteConfirm = new TodoDeleteConfirmComponent(theme, message, (confirmed) => {
              if (!confirmed) {
                setActiveComponent(actionMenu);
                return;
              }
              void (async () => {
                await applyTodoAction(record, "delete");
                setActiveComponent(selector);
              })();
            });
            setActiveComponent(deleteConfirm);
            return;
          }

          const result = await applyTodoAction(record, action);
          if (result === "stay") {
            setActiveComponent(selector);
          }
        };

        const showActionMenu = async (todo: TodoFrontMatter | TodoRecord) => {
          const record = "body" in todo ? todo : await resolveTodoRecord(todo);
          if (!record) return;
          actionMenu = new TodoActionMenuComponent(
            theme,
            record,
            (action) => {
              void handleActionSelection(record, action);
            },
            () => {
              setActiveComponent(selector);
            },
          );
          setActiveComponent(actionMenu);
        };

        const handleSelect = async (todo: TodoFrontMatter) => {
          await showActionMenu(todo);
        };

        selector = new TodoSelectorComponent(
          tui,
          theme,
          keybindings,
          todos,
          (todo) => {
            void handleSelect(todo);
          },
          () => done(),
          searchTerm || undefined,
        );

        setActiveComponent(selector);

        const rootComponent = {
          get focused() {
            return wrapperFocused;
          },
          set focused(value: boolean) {
            wrapperFocused = value;
            if (activeComponent && "focused" in activeComponent) {
              activeComponent.focused = value;
            }
          },
          render(width: number) {
            return activeComponent ? activeComponent.render(width) : [];
          },
          invalidate() {
            activeComponent?.invalidate();
          },
          handleInput(data: string) {
            activeComponent?.handleInput?.(data);
          },
        };

        return rootComponent;
      });
    },
  });
}
