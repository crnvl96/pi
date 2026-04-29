export type BrowserOpenCommand = {
  command: string;
  args: string[];
};

export function appendSeparated(text: string, suffix: string) {
  return `${text}${text && !/\s$/.test(text) ? " " : ""}${suffix}`;
}

export function getBrowserOpenCommand(platform: NodeJS.Platform, url: string): BrowserOpenCommand {
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];

  return { command, args };
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isPng(buffer: Buffer) {
  return buffer
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

export function toHtmlSafeJson(value: string) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
