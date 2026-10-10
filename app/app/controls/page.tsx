import type { Metadata } from "next";
import { togglePauseAction } from "@/app/app/actions";
import { LimitsForm } from "@/components/limits-form";
import { getLimits } from "@/lib/server/repos/limits";
import { requireOnboarded } from "@/lib/server/session";
import "./controls.css";

export const metadata: Metadata = { title: "Controls | Kairis" };

export default async function ControlsPage() {
  const user = await requireOnboarded("/app/controls");
  const limits = await getLimits(user.id);

  return (
    <>
      <header className="page-copy">
        <p className="eyebrow">Controls</p>
        <h1>Limits and kill switch</h1>
        <p className="lede">Limits are protection, not friction. They apply to paper and live orders alike.</p>
      </header>

      <section className="panel kill-switch" data-paused={limits.tradingPaused ? "true" : "false"} aria-labelledby="kill-switch-heading">
        <h2 id="kill-switch-heading">Kill switch</h2>
        <p className="kill-switch-state" role="status">
          {limits.tradingPaused ? "Paused" : "Active"}
        </p>
        <p className="panel-copy">
          {limits.tradingPaused
            ? "Trading is paused. No new paper or live order can be placed until you resume."
            : "Trading is active. Pausing stops every new paper and live order at once. Orders already at the exchange are not cancelled."}
        </p>
        <form action={togglePauseAction} className="button-row">
          <input type="hidden" name="paused" value={limits.tradingPaused ? "false" : "true"} />
          <button type="submit" className={limits.tradingPaused ? "cta-secondary" : "cta-danger"}>
            {limits.tradingPaused ? "Resume trading" : "Pause trading"}
          </button>
        </form>
      </section>

      <section className="panel" aria-labelledby="limits-heading">
        <h2 id="limits-heading">Your limits</h2>
        <p className="panel-copy">
          Every order is checked against these first. When one stops an order, Kairis tells you which limit and why.
        </p>
        <LimitsForm limits={limits} />
      </section>

      <section className="panel" aria-labelledby="always-heading">
        <h2 id="always-heading">Always enforced</h2>
        <ul>
          <li>Market data older than 5 minutes halts new orders until it refreshes.</li>
          <li>An unreachable exchange or market feed halts new orders.</li>
          <li>A sell cannot exceed the position Kairis recorded for that product.</li>
        </ul>
      </section>
    </>
  );
}
