"use client";

import { useEffect } from "react";

// The webview shows WebKit's default context menu (Reload, Inspect, ...) on
// right-click, which looks like a browser rather than a desktop app.
export function NoContextMenu() {
  useEffect(() => {
    const suppress = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
  }, []);

  return null;
}
