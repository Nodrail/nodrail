import type { Tone } from "@/components/app/tones";
import type { InventoryRowDto } from "@/contracts/v1/inventory";

export const hostNames: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  copilot: "Copilot",
};

/**
 * One status per row, the most pressing first, in words that claim no
 * more than the installation reported: a configured hook is not a verified
 * one, and a stale report says nothing about now.
 */
export function rowStatus(row: InventoryRowDto): { tone: Tone; label: string } {
  if (row.stale) return { tone: "neutral", label: "Stale: no recent report" };
  if (row.activation === "inactive")
    return { tone: "danger", label: "Hook not running" };
  if (row.activation === "unknown")
    return { tone: "warning", label: "Coverage unknown" };
  if (row.drift > 0) return { tone: "warning", label: "Drifted" };
  if (row.behind) return { tone: "warning", label: "Behind" };
  if (!row.inStep) return { tone: "warning", label: "Not as locked" };
  return row.activation === "verified"
    ? { tone: "success", label: "Activation verified by local check" }
    : { tone: "info", label: "Hook configured" };
}

/** Unmanaged items by kind, in words: "2 skills, 1 plugin". */
export function unmanagedText(unmanaged: Record<string, number>) {
  const parts = Object.entries(unmanaged)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => {
      const word = kind.replaceAll("_", " ").replace(/^mcp /, "MCP ");
      return `${count} ${word}${count === 1 ? "" : "s"}`;
    });
  return parts.length > 0 ? parts.join(", ") : "None";
}

/** A revision as people compare it: its first 12 characters. */
export const shortRevision = (revision: string | null) =>
  revision ? revision.slice(0, 12) : "—";
