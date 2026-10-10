import type { Metadata } from "next";
import { togglePauseAction } from "@/app/app/actions";
import { savePreferredModeAction } from "@/app/app/controls/actions";
import { LimitsForm } from "@/components/limits-form";
import { PUBLIC_MODES, type PublicMode } from "@/lib/domain/limits-form";
import { STRATEGY } from "@/lib/domain/strategy";
import { firstString } from "@/lib/search-params";
import { getLimits } from "@/lib/server/repos/limits";
import { getOnboarding } from "@/lib/server/repos/onboarding";
import { requireOnboarded } from "@/lib/server/session";
import "./controls.css";

export const metadata: Metadata = { title: "Controls | Kairis" };

const MODE_COPY: Record<PublicMode, string> = {
  paper: "Paper: simulated fills, nothing reaches an exchange.",
  manual: "Manual: review signals and checks here, place orders yourself on your exchange.",
  assisted: "Assisted: Kairis prepares each order on your exchange; nothing is placed until you approve it."
};

export default async function ControlsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOnboarded("/app/controls");
  const sp = await searchParams;
  const [limits, onboarding] = await Promise.all([getLimits(user.id), getOnboarding(user.id)]);
  const preferred = PUBLIC_MODES.find((m) => m === onboarding.preferredMode) ?? "paper";
  const modeSaved = firstString(sp, "mode") === "saved";
  const modeError = firstString(sp, "modeError");
  const staleMinutes = Math.round(STRATEGY.maxTickerAgeMs / 60_000);

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
          Every order is checked against these first. When one stops an order, Kairis tells you which limit and why. Limits stop new buys only: exits (a sell that reduces a position you hold) are always allowed. Only the kill switch stops everything.
          &quot;Today&quot; means the current UTC day (00:00 to 24:00 UTC) everywhere in Kairis.
        </p>
        <LimitsForm limits={limits} />
      </section>

      <section className="panel" aria-labelledby="mode-heading">
        <h2 id="mode-heading">Preferred mode</h2>
        <p className="panel-copy">
          The workflow you start from. Changing it does not place, cancel or move anything; live orders still need a
          connected exchange and your approval.
        </p>
        {modeError ? (
          <p className="error-copy" role="alert">
            {modeError}
          </p>
        ) : null}
        {modeSaved ? (
          <p className="success-copy" role="status">
            Preferred mode saved
          </p>
        ) : null}
        <form action={savePreferredModeAction} className="form-grid">
          <label className="field">
            <span className="field-label">Preferred mode</span>
            <select name="preferredMode" defaultValue={preferred} key={preferred}>
              {PUBLIC_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {MODE_COPY[mode]}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button type="submit" className="cta-secondary">
              Save preferred mode
            </button>
          </div>
        </form>
      </section>

      <section className="panel" aria-labelledby="always-heading">
        <h2 id="always-heading">Always enforced</h2>
        <ul>
          <li>Market data older than {staleMinutes} minutes halts new orders until it refreshes.</li>
          <li>An unreachable exchange or market feed halts new orders.</li>
          <li>A product Coinbase does not list is blocked.</li>
          <li>A sell cannot exceed the position Kairis recorded for that product.</li>
        </ul>
      </section>
    </>
  );
}
