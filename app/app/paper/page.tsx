import type { Metadata } from "next";
import Link from "next/link";
import "./paper.css";
import { ModeBadge } from "@/components/mode-badge";
import { PaperTicket } from "@/components/paper-ticket";
import { PositionsTable } from "@/components/positions-table";
import { isUuid, MAX_TICKET_USD, normalizeProductId } from "@/lib/domain/order-form";
import { buildPositions, dayStats } from "@/lib/domain/paper";
import { WATCHLIST } from "@/lib/domain/strategy";
import { num, usd, when } from "@/lib/format";
import { getLimits } from "@/lib/server/repos/limits";
import { listPaperTrades } from "@/lib/server/repos/paper";
import { getReferencePrices } from "@/lib/server/services/market";
import { requireOnboarded } from "@/lib/server/session";
import type { DayStats, PaperTrade, TradingLimits } from "@/lib/types";

export const metadata: Metadata = { title: "Paper trading | Kairis" };

const JOURNAL_ROWS = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function ticketDefaults(params: Awaited<SearchParams>): { productId?: string; quoteUsd?: number; signalId?: string } {
  const productId = normalizeProductId(first(params.product)) ?? undefined;
  const quote = Number(first(params.quote));
  const quoteUsd = Number.isFinite(quote) && quote > 0 && quote <= MAX_TICKET_USD ? Math.round(quote * 100) / 100 : undefined;
  const signal = first(params.signal);
  return { productId, quoteUsd, signalId: isUuid(signal) ? signal : undefined };
}

function signedUsd(n: number): string {
  return n > 0 ? `+${usd(n)}` : usd(n);
}

/** The risk engine's cooldown rule, restated for display: active until `cooldownMinutes` after the last loss. */
function cooldownUntil(today: DayStats, limits: TradingLimits, now: Date): Date | null {
  if (today.consecutiveLosses < limits.lossStreakTrigger || !today.lastLossAt) return null;
  const until = new Date(new Date(today.lastLossAt).getTime() + limits.cooldownMinutes * 60_000);
  return until > now ? until : null;
}

function statusPill(trade: PaperTrade): { label: string; className: string } {
  if (trade.status === "filled") return { label: "Filled", className: "pill pill-ok" };
  if (trade.riskDecision?.outcome === "halted") return { label: "Halted", className: "pill pill-warn" };
  return { label: "Blocked", className: "pill pill-bad" };
}

/** The user's note; a blocked row also carries the first reason unless the note already says it. */
function noteCell(trade: PaperTrade): { note: string; reason: string | null } {
  const reason = trade.status === "blocked" ? (trade.riskDecision?.reasons[0] ?? null) : null;
  if (!trade.note) return { note: reason ?? "", reason: null };
  return { note: trade.note, reason: reason && !trade.note.includes(reason) ? reason : null };
}

export default async function PaperPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireOnboarded("/app/paper");
  const defaults = ticketDefaults(await searchParams);
  const [limits, trades] = await Promise.all([getLimits(user.id), listPaperTrades(user.id, 1000)]);
  const held = Object.keys(buildPositions(trades, {}));
  const prices = held.length > 0 ? await getReferencePrices(held) : {};
  const positions = buildPositions(trades, prices);
  const now = new Date();
  const today = dayStats(trades, now);
  const cooldown = cooldownUntil(today, limits, now);
  const journal = trades.slice(0, JOURNAL_ROWS);

  return (
    <div className="paper-page" data-mode="paper">
      <header className="page-copy">
        <div className="paper-eyebrow">
          <p className="eyebrow">Paper mode</p>
          <ModeBadge mode="paper" />
        </div>
        <h1>Paper trading</h1>
        <p className="lede">Simulated fills at the current Coinbase price. Same risk engine as live. No money moves.</p>
      </header>

      <section className="panel" aria-labelledby="paper-today">
        <div className="panel-heading">
          <h2 id="paper-today">Today (UTC)</h2>
          <Link className="inline-link" href="/app/controls">
            Your limits
          </Link>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">Trades today</span>
            <span className="stat-value">
              {today.tradesCount} of {limits.maxTradesPerDay}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Realized P&amp;L today</span>
            <span className="stat-value">{signedUsd(today.realizedPnlUsd)}</span>
            <span className="field-help">Loss cap {usd(limits.dailyLossCapUsd)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Consecutive losses</span>
            <span className="stat-value">
              {today.consecutiveLosses} of {limits.lossStreakTrigger}
            </span>
            <span className="field-help">A {limits.cooldownMinutes} min cooldown starts at {limits.lossStreakTrigger}.</span>
          </div>
          <div className="stat">
            <span className="stat-label">Cooldown</span>
            <span className="stat-value">{cooldown ? "Active" : "None"}</span>
            {cooldown ? <span className="field-help">New orders are blocked until {when(cooldown.toISOString())}.</span> : null}
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="paper-ticket-heading">
        <div className="panel-heading">
          <h2 id="paper-ticket-heading">New paper order</h2>
          <ModeBadge mode="paper" />
        </div>
        <PaperTicket
          key={`${defaults.productId ?? ""}|${defaults.quoteUsd ?? ""}|${defaults.signalId ?? ""}`}
          defaults={defaults}
          watchlist={WATCHLIST}
        />
      </section>

      <section className="panel" aria-labelledby="paper-positions">
        <h2 id="paper-positions">Positions</h2>
        <PositionsTable positions={positions} prices={prices} />
      </section>

      <section className="panel" aria-labelledby="paper-journal">
        <div className="panel-heading">
          <h2 id="paper-journal">Paper journal</h2>
          {trades.length > JOURNAL_ROWS ? (
            <Link className="inline-link" href="/app/journal">
              Full journal
            </Link>
          ) : null}
        </div>
        {journal.length === 0 ? (
          <p className="empty">No paper orders yet. Every order you place, filled or blocked, is recorded here.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Product</th>
                  <th scope="col">Side</th>
                  <th scope="col" className="num">Size</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col" className="num">Quote</th>
                  <th scope="col" className="num">Realized P&amp;L</th>
                  <th scope="col">Status</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((trade) => {
                  const pill = statusPill(trade);
                  const filled = trade.status === "filled";
                  const cell = noteCell(trade);
                  return (
                    <tr key={trade.id}>
                      <td>{when(trade.createdAt)}</td>
                      <td>{trade.productId}</td>
                      <td>{trade.side}</td>
                      <td className="num">{filled ? num(trade.baseSize, 8) : "n/a"}</td>
                      <td className="num">{trade.price > 0 ? usd(trade.price) : "n/a"}</td>
                      <td className="num">{usd(trade.quoteUsd)}</td>
                      <td className="num">{filled ? signedUsd(trade.realizedPnlUsd) : "n/a"}</td>
                      <td>
                        <span className={pill.className}>{pill.label}</span>
                      </td>
                      <td className="paper-note">
                        {cell.note}
                        {cell.reason ? <span className="paper-reason">{cell.reason}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {trades.length > JOURNAL_ROWS ? (
              <p className="field-help">Showing the latest {JOURNAL_ROWS} of {trades.length} paper orders.</p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
