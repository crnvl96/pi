/**
 * Utility functions for the plan-mode extension.
 */

const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bcurl\b[^;&|\n]*(?:\s-o\b|\s--output\b|\s-O\b|\s--remote-name\b)/i,
  /\bwget\b[^;&|\n]*(?:\s-O\b|\s--output-document\b)(?!\s*-\b)/i,
  /\bnpm\s+(install|uninstall|update|ci|link|publish|run\s+build)/i,
  /\byarn\s+(add|remove|install|publish|run\s+build)/i,
  /\bpnpm\s+(add|remove|install|publish|run\s+build)/i,
  /\bpip\s+(install|uninstall)/i,
  /\buv\s+(add|remove|sync|pip\s+install|pip\s+uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone|apply|am)/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
  /\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish)\b/i,
];

const SAFE_SEGMENT_PATTERNS = [
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*cat\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*head\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*tail\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*less\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*more\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*grep\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*rg\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*find\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*fd\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*ls\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*pwd\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*echo\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*printf\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*wc\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*sort\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*uniq\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*diff\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*file\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*stat\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*du\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*df\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*tree\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*which\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*whereis\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*type\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*env\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*printenv\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*uname\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*whoami\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*id\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*date\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*uptime\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*ps\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*free\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*git\s+(status|log|diff|show|grep|branch|remote|config\s+--get|ls-|rev-parse|merge-base)\b/i,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*yarn\s+(list|info|why|audit)\b/i,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*pnpm\s+(list|view|info|why|audit)\b/i,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*node\s+--version\b/i,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*python3?\s+--version\b/i,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*uv\s+(--version|python\s+list|tool\s+list)\b/i,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*jq\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*sed\s+-n\b/i,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*awk\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*bat\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*eza\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*curl\b/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*wget\s+-O\s*-\b/i,
];

export interface PlanItem {
  step: number;
  text: string;
  completed: boolean;
}

export function isSafeCommand(command: string): boolean {
  if (!command.trim()) return false;
  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) return false;

  const segments = command
    .split(/&&|\|\||;|\n|\|/g)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.length > 0 && segments.every((segment) => SAFE_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment)));
}

function cleanStepText(text: string): string {
  return text
    .replace(/^\[[ xX]\]\s+/, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  return /^[A-Z][A-Za-z0-9 &/(),-]{1,80}:\s*$/.test(trimmed);
}

export function extractPlanItems(message: string): PlanItem[] {
  const lines = message.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\s*(?:#{1,6}\s*)?(?:\*\*)?Plan(?:\*\*)?\s*:?\s*$/i.test(line));
  if (headerIndex < 0) return [];

  const items: PlanItem[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      const text = cleanStepText(numbered[2] ?? "");
      if (text.length > 3) {
        items.push({ step: items.length + 1, text, completed: false });
      }
      continue;
    }

    if (items.length > 0 && looksLikeSectionHeader(line)) break;
  }

  return items;
}

export function extractDoneSteps(message: string): number[] {
  const steps: number[] = [];
  for (const match of message.matchAll(/\[DONE:\s*(\d+)\]/gi)) {
    const step = Number(match[1]);
    if (Number.isInteger(step) && step > 0) steps.push(step);
  }
  return steps;
}

export function markCompletedSteps(text: string, items: PlanItem[]): number {
  let changed = 0;
  for (const step of extractDoneSteps(text)) {
    const item = items.find((candidate) => candidate.step === step);
    if (item && !item.completed) {
      item.completed = true;
      changed++;
    }
  }
  return changed;
}

export function formatPlanItems(items: PlanItem[]): string {
  return items.map((item) => `${item.step}. ${item.text}`).join("\n");
}
