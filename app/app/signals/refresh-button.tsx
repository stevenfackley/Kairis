"use client";

import { useFormStatus } from "react-dom";

/** Disabled while the refresh runs: each click writes a signal row per product and an audit entry. */
export function RefreshButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cta-primary button-reset" disabled={pending}>
      {pending ? "Refreshing..." : "Refresh signals"}
    </button>
  );
}
