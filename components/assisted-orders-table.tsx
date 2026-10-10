import { short, usd, when } from "@/lib/format";
import type { AssistedOrder, AssistedStatus, ReconcileState } from "@/lib/types";

const STATUS_PILL: Record<AssistedStatus, "pill-ok" | "pill-warn" | "pill-bad"> = {
  filled: "pill-ok",
  previewed: "pill-warn",
  submitted: "pill-warn",
  blocked: "pill-bad",
  failed: "pill-bad",
  cancelled: "pill-bad",
  expired: "pill-bad"
};

const RECONCILE_PILL: Record<ReconcileState, "pill-ok" | "pill-warn" | "pill-bad"> = {
  reconciled: "pill-ok",
  pending: "pill-warn",
  error: "pill-bad"
};

export function AssistedOrdersTable({ orders }: { orders: AssistedOrder[] }) {
  if (orders.length === 0) {
    return <p className="empty">No assisted orders yet. Previews, blocks and submissions you make above appear here.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Product</th>
            <th scope="col">Side</th>
            <th scope="col" className="num">
              Quote
            </th>
            <th scope="col">Status</th>
            <th scope="col">Reconcile</th>
            <th scope="col">Provider</th>
            <th scope="col">Order id</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>{when(order.createdAt)}</td>
              <td>{order.productId}</td>
              <td>{order.side}</td>
              <td className="num">{usd(order.quoteUsd)}</td>
              <td>
                <span className={`pill ${STATUS_PILL[order.status]}`}>{order.status}</span>
              </td>
              <td>
                <span className={`pill ${RECONCILE_PILL[order.reconcileState]}`}>{order.reconcileState}</span>
              </td>
              <td>{order.provider}</td>
              <td>{order.orderId ? <code title={order.orderId}>{short(order.orderId)}</code> : <span className="field-help">none</span>}</td>
              <td>{order.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
