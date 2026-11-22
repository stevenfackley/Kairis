import type { AssistedOrder, AssistedStatus } from "@/lib/types";

type StatusTone = "pill-ok" | "pill-warn" | "pill-bad";

type StatusMeaning = {
  /** The pill shown for the status. */
  tone: StatusTone;
  /** The exchange took the order and it has not ended unfilled: it is in flight or filled. */
  inFlightOrFilled: boolean;
  /** Ended without a full fill, yet Coinbase can still report a partial fill on it. */
  mayReportPartialFill: boolean;
};

/** What each assisted-order status means. A new status fails to compile until it has a row here. */
export const ASSISTED_STATUS: Record<AssistedStatus, StatusMeaning> = {
  previewed: { tone: "pill-warn", inFlightOrFilled: false, mayReportPartialFill: false },
  submitted: { tone: "pill-warn", inFlightOrFilled: true, mayReportPartialFill: false },
  filled: { tone: "pill-ok", inFlightOrFilled: true, mayReportPartialFill: false },
  blocked: { tone: "pill-bad", inFlightOrFilled: false, mayReportPartialFill: false },
  failed: { tone: "pill-bad", inFlightOrFilled: false, mayReportPartialFill: true },
  cancelled: { tone: "pill-bad", inFlightOrFilled: false, mayReportPartialFill: true },
  expired: { tone: "pill-bad", inFlightOrFilled: false, mayReportPartialFill: true }
};

/**
 * An order counts toward exposure when it filled, when it is still in flight (a submitted market IOC
 * order almost always fills before reconcile runs, so ignoring it would let rapid submits stack past
 * the limits), or when a terminal non-fill status still reports a partial fill.
 */
export function countsTowardExposure(order: Pick<AssistedOrder, "status" | "filledSize">): boolean {
  const meaning = ASSISTED_STATUS[order.status];
  return meaning.inFlightOrFilled || (meaning.mayReportPartialFill && (order.filledSize ?? 0) > 0);
}
