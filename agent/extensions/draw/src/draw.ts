/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import React from "react";
import { createRoot } from "react-dom/client";
import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import "./draw.css";

declare global {
  interface Window {
    __PI_DRAW_TOKEN__?: string;
  }
}

const token = window.__PI_DRAW_TOKEN__;
if (!token) throw new Error("Missing pi draw token.");
const TOKEN: string = token;

const submitButtonElement = document.getElementById("submit");
if (!(submitButtonElement instanceof HTMLButtonElement)) throw new Error("Missing submit button.");
const submitButton: HTMLButtonElement = submitButtonElement;

const root = document.getElementById("root");
if (!root) throw new Error("Missing draw root.");

let editor: Editor | null = null;
let submitting = false;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

function flashButton(className: "did-submit" | "did-error") {
  submitButton.classList.remove("did-submit", "did-error");
  if (feedbackTimer) clearTimeout(feedbackTimer);
  submitButton.classList.add(className);
  feedbackTimer = setTimeout(() => submitButton.classList.remove(className), 650);
}

function updateButton() {
  submitButton.disabled = !editor || submitting;
  submitButton.classList.toggle("is-submitting", submitting);
  submitButton.setAttribute("aria-busy", submitting ? "true" : "false");
}

async function submitDrawing() {
  if (!editor || submitting) return;

  const ids = Array.from(editor.getCurrentPageShapeIds());
  if (ids.length === 0) {
    flashButton("did-error");
    return;
  }

  submitting = true;
  updateButton();

  try {
    if (editor.fonts?.loadRequiredFontsForCurrentPage) {
      await editor.fonts.loadRequiredFontsForCurrentPage(editor.options.maxFontsToLoadBeforeRender);
    }

    const result = await editor.toImage(ids, {
      format: "png",
      background: true,
      padding: 48,
      scale: 2,
      darkMode: false,
    });
    if (!result?.blob) throw new Error("Could not render this drawing.");

    const response = await fetch("/submit?token=" + encodeURIComponent(TOKEN), {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: result.blob,
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      inserted?: boolean;
    };
    if (!response.ok || !data.ok) {
      throw new Error(data.error || response.statusText || "Submit failed");
    }

    flashButton(data.inserted ? "did-submit" : "did-error");
  } catch (error) {
    console.error(error);
    flashButton("did-error");
  } finally {
    submitting = false;
    updateButton();
  }
}

submitButton.addEventListener("click", submitDrawing);

const events = new EventSource("/events?token=" + encodeURIComponent(TOKEN));

function notifyClosed() {
  events.close();
  try {
    navigator.sendBeacon(
      "/closed?token=" + encodeURIComponent(TOKEN),
      new Blob([], { type: "text/plain" }),
    );
  } catch {
    // Best effort only.
  }
}
window.addEventListener("pagehide", notifyClosed);
window.addEventListener("beforeunload", notifyClosed);

function App() {
  return React.createElement(Tldraw, {
    persistenceKey: "pi-draw-canvas",
    autoFocus: true,
    onMount: (mountedEditor) => {
      editor = mountedEditor;
      updateButton();
      return () => {
        editor = null;
        updateButton();
      };
    },
  });
}

createRoot(root).render(React.createElement(App));
