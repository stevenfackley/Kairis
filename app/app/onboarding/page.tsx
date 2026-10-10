import type { Metadata } from "next";
import { OnboardingForm } from "@/components/onboarding-form";
import { getOnboarding } from "@/lib/server/repos/onboarding";
import { requireUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Get started | Kairis" };

export default async function OnboardingPage() {
  const user = await requireUser("/app/onboarding");
  const onboarding = await getOnboarding(user.id);
  const mode = onboarding.preferredMode === "manual" || onboarding.preferredMode === "assisted" ? onboarding.preferredMode : "paper";

  return (
    <>
      <header className="page-copy">
        <p className="eyebrow">Get started</p>
        <h1>Before you trade</h1>
        <p className="lede">
          A minute on how Kairis works and what it will never do. Your answers set your starting mode; you can change it
          later.
        </p>
      </header>

      <section className="grid">
        <article className="panel">
          <h2>How Kairis works</h2>
          <ul>
            <li>Everyone starts in paper mode: simulated fills at live market prices, with your limits applied exactly as they will be later.</li>
            <li>Every order is checked against your limits first. When Kairis blocks one, it tells you why in plain words.</li>
            <li>Assisted execution prepares an order on your exchange account and waits. Nothing is placed without your explicit approval.</li>
            <li>Signals, decisions and orders are logged so you can review and export them.</li>
          </ul>
        </article>
        <article className="panel">
          <h2>What it never does</h2>
          <ul>
            <li>Hold your funds. Your money stays on your exchange.</li>
            <li>Accept a key that can withdraw or transfer funds. Create a trade-only key; any other is rejected.</li>
            <li>Trade on its own for you. There is no automated trading for public accounts.</li>
            <li>Promise returns. Signals are rule-based context, not advice, and trading can lose money.</li>
          </ul>
        </article>
      </section>

      <OnboardingForm defaultMode={mode} acknowledged={onboarding.riskAcknowledged} />
    </>
  );
}
