import { num, usd } from "@/lib/format";
import type { PositionMap } from "@/lib/types";

function signedUsd(n: number): string {
  return n > 0 ? `+${usd(n)}` : usd(n);
}

type PositionsTableProps = { positions: PositionMap; prices: Record<string, number> };

/** Open positions marked at `prices`; a product with no price shows n/a instead of a guessed P&L. */
export function PositionsTable({ positions, prices }: PositionsTableProps) {
  const rows = Object.entries(positions).sort(([a], [b]) => a.localeCompare(b));
  if (rows.length === 0) {
    return <p className="empty">No open paper positions. A filled paper buy shows up here.</p>;
  }
  const missingMarks = rows.some(([productId]) => prices[productId] === undefined);

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col" className="num">Size</th>
            <th scope="col" className="num">Avg cost</th>
            <th scope="col" className="num">Mark</th>
            <th scope="col" className="num">Notional</th>
            <th scope="col" className="num">Unrealized P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([productId, position]) => {
            const mark = prices[productId];
            const pnl = mark === undefined ? null : (mark - position.avgCost) * position.baseSize;
            return (
              <tr key={productId}>
                <td>{productId}</td>
                <td className="num">{num(position.baseSize, 8)}</td>
                <td className="num">{usd(position.avgCost)}</td>
                <td className="num">{mark === undefined ? "n/a" : usd(mark)}</td>
                <td className="num">{usd(position.notionalUsd)}</td>
                <td className="num">
                  {pnl === null ? (
                    "n/a"
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
        <p className="field-help">Market data was unavailable for some products; their notional uses the average cost.</p>
      ) : null}
    </div>
  );
}
