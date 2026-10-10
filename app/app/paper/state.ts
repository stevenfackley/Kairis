import type { PaperTrade, RiskDecision } from "@/lib/types";

// Kept out of actions.ts: a "use server" module may only export async functions.
export type PaperTicketState = {
  error: string | null;
  result: { trade: PaperTrade; decision: RiskDecision } | null;
};

export const INITIAL_PAPER_TICKET_STATE: PaperTicketState = { error: null, result: null };
