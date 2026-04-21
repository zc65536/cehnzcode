import type { UIAdapter } from "../types.js";

export type UIType = "tui" | "gui";

export function createUI(type: UIType = "tui"): UIAdapter {
  switch (type) {
    case "tui":
      // Lazy import to avoid loading TUI dependencies when not needed
      const { TUIAdapter } = require("./tui/index.js");
      return new TUIAdapter();
    default:
      throw new Error(`UI type "${type}" not implemented`);
  }
}
