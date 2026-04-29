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
const rootElement = document.getElementById("root");
const submitElement = document.getElementById("submit");

if (!token) throw new Error("Missing pi draw token.");
if (!rootElement) throw new Error("Missing draw root.");
if (!(submitElement instanceof HTMLButtonElement)) throw new Error("Missing submit button.");

const TOKEN = token;
const root = rootElement;
const submitButton = submitElement;
let editor: Editor | undefined;

async function submitDrawing() {
  if (!editor) return;

  const ids = [...editor.getCurrentPageShapeIds()];
  if (ids.length === 0) return;

  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";

  try {
    await editor.fonts?.loadRequiredFontsForCurrentPage?.(
      editor.options.maxFontsToLoadBeforeRender,
    );
    const image = await editor.toImage(ids, {
      format: "png",
      background: true,
      padding: 48,
      scale: 2,
      darkMode: false,
    });

    const response = await fetch(`/submit?token=${encodeURIComponent(TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: image.blob,
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.error || "Submit failed");

    submitButton.textContent = "Submitted";
  } catch (error) {
    console.error(error);
    submitButton.textContent = "Submit failed";
  } finally {
    setTimeout(() => {
      submitButton.disabled = false;
      submitButton.textContent = "Submit to Pi";
    }, 900);
  }
}

submitButton.addEventListener("click", submitDrawing);

createRoot(root).render(
  React.createElement(Tldraw, {
    autoFocus: true,
    onMount: (mountedEditor) => {
      editor = mountedEditor;
      submitButton.disabled = false;
      return () => {
        editor = undefined;
        submitButton.disabled = true;
      };
    },
  }),
);
