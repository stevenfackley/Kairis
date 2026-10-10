import type { TradeMode } from "@/lib/types";

const LABEL: Record<TradeMode, string> = {
  paper: "Paper mode: simulated orders only",
  live: "Live mode: orders can reach your exchange"
};

/** PAPER / LIVE in words, so the mode never relies on colour alone. */
export function ModeBadge({ mode }: { mode: TradeMode }) {
  return (
    <span className="mode-badge" data-mode={mode} role="img" aria-label={LABEL[mode]} title={LABEL[mode]}>
      {mode === "paper" ? "PAPER" : "LIVE"}
    </span>
  );
}
