/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * Supports multiple terminal protocols:
 * - OSC 777: Ghostty, iTerm2, WezTerm, rxvt-unicode
 * - OSC 99: Kitty
 * - Windows toast: Windows Terminal (WSL)
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}

function sanitizeOscText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f\x1b\x07]/g, " ");
}

function windowsToastScript(title: string, body: string): string {
  const type = "Windows.UI.Notifications";
  const escapedTitle = escapePowerShellString(title);
  const escapedBody = escapePowerShellString(body);
  const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
  const template = `[${type}.ToastTemplateType]::ToastText01`;
  const toast = `[${type}.ToastNotification]::new($xml)`;
  return [
    `${mgr} > $null`,
    `$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
    `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${escapedBody}')) > $null`,
    `[${type}.ToastNotificationManager]::CreateToastNotifier('${escapedTitle}').Show(${toast})`,
  ].join("; ");
}

function notifyOSC777(title: string, body: string): void {
  const safeTitle = sanitizeOscText(title);
  const safeBody = sanitizeOscText(body);
  process.stdout.write(`\x1b]777;notify;${safeTitle};${safeBody}\x07`);
}

function notifyOSC99(title: string, body: string): void {
  const safeTitle = sanitizeOscText(title);
  const safeBody = sanitizeOscText(body);
  process.stdout.write(`\x1b]99;i=1:d=0;${safeTitle}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${safeBody}\x1b\\`);
}

function notifyWindows(title: string, body: string): void {
  execFile(
    "powershell.exe",
    ["-NoProfile", "-Command", windowsToastScript(title, body)],
    (error) => {
      if (error) {
        return;
      }
    },
  );
}

function canNotifyTerminal(): boolean {
  return process.stdout.isTTY === true;
}

function notify(title: string, body: string): void {
  if (!canNotifyTerminal()) {
    return;
  }

  if (process.env.WT_SESSION) {
    notifyWindows(title, body);
    return;
  }

  if (process.env.KITTY_WINDOW_ID) {
    notifyOSC99(title, body);
    return;
  }

  notifyOSC777(title, body);
}

export default function notifyExtension(pi: ExtensionAPI) {
  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    notify("Pi", "Ready for input");
  });
}
