import { usdPrice } from "@/lib/domain/money";
import { num, usd } from "@/lib/format";
import type { PositionMap } from "@/lib/types";

const NO_PRICE = "price unavailable";

function signedUsd(n: number): string {
  return n > 0 ? `+${usd(n)}` : usd(n);
}

/** A usable mark, or null: a missing, zero or non-finite price never becomes a $0 mark or a NaN P&L. */
function markFor(prices: Record<string, number>, productId: string): number | null {
  const mark = prices[productId];
  return typeof mark === "number" && Number.isFinite(mark) && mark > 0 ? mark : null;
}

type PositionsTableProps = { positions: PositionMap; prices: Record<string, number> };

/**
 * Open positions marked at `prices`. Average cost and cost basis include buy fees. A product with no
 * usable price says so instead of showing a guessed value or P&L.
 */
export function PositionsTable({ positions, prices }: PositionsTableProps) {
  const rows = Object.entries(positions).sort(([a], [b]) => a.localeCompare(b));
  if (rows.length === 0) {
    return <p className="empty">No open paper positions. A filled paper buy shows up here.</p>;
  }
  const missingMarks = rows.some(([productId]) => markFor(prices, productId) === null);

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col" className="num">Size</th>
            <th scope="col" className="num">Avg cost</th>
            <th scope="col" className="num">Cost basis</th>
            <th scope="col" className="num">Mark</th>
            <th scope="col" className="num">Market value</th>
            <th scope="col" className="num">Unrealized P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([productId, position]) => {
            const mark = markFor(prices, productId);
            const costBasis = position.avgCost * position.baseSize;
            const value = mark === null ? null : mark * position.baseSize;
            const pnl = value === null ? null : value - costBasis;
            return (
              <tr key={productId}>
                <td>{productId}</td>
                <td className="num">{num(position.baseSize, 8)}</td>
                <td className="num">{usdPrice(position.avgCost)}</td>
                <td className="num">{usd(costBasis)}</td>
                <td className="num">{mark === null ? NO_PRICE : usdPrice(mark)}</td>
                <td className="num">{value === null ? NO_PRICE : usd(value)}</td>
                <td className="num">
                  {pnl === null ? (
                    NO_PRICE
                  ) : (
                    <span className={`pill ${pnl >= 0 ? "pill-ok" : "pill-bad"}`}>{signedUsd(pnl)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {missingMarks ? (
        <p className="field-help">
          Market data is unavailable for some products right now, so their market value and unrealized P&amp;L are not
          shown. Reload to try again.
        </p>
      ) : null}
    </div>
  );
}
