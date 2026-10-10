import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

const pillars = [
  {
    title: "Control before execution",
    body: "Kairis helps you decide when to act and when not to act: every order passes the limits you set before it can go anywhere."
  },
  {
    title: "Clear modes, clear authority",
    body: "Work in paper, manual or assisted mode with visible boundaries, and the current mode shown on every screen that can place an order."
  },
  {
    title: "Trust through records",
    body: "Signals, approvals, orders and outcomes are logged so you can understand what happened and export it."
  },
  {
    title: "Safety for real users",
    body: "Built for people who need structure, not hype: blocked actions are explained in plain language and a kill switch is always one click away."
  }
];

const notList = [
  "Not a broker. Orders go to your own exchange account, under your own name.",
  "Not a custodian. Your funds stay on your exchange; Kairis never holds them.",
  "No withdrawal permissions. A key that can transfer funds is rejected.",
  "No profit guarantees. Signals are rule-based context, not advice, and trading can lose money.",
  "No leverage. Spot trading only."
];

const steps = [
  {
    title: "1. Start in paper mode",
    body: "Practice on live market prices with simulated fills. Your limits and the kill switch apply exactly as they will later."
  },
  {
    title: "2. Connect a trade-only key",
    body: "Add a Coinbase API key with view and trade permission only. Kairis checks the key and refuses one that can move funds."
  },
  {
    title: "3. Assisted execution",
    body: "Kairis prepares the order and shows the risk checks and exchange preview. Nothing is placed until you approve it."
  }
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <BrandMark />

        <div className="hero-copy">
          <p className="eyebrow">Non-custodial trading workflows</p>
          <h1>Kairis</h1>
          <p className="lede">
            Act at the right moment, within limits you set. Kairis puts risk checks, approvals and records between a
            signal and an order. Your funds stay on your exchange.
          </p>
        </div>
      </section>

      <section className="cta-strip">
        <Link className="cta-primary" href="/sign-in">
          Sign in
        </Link>
        <Link className="cta-secondary" href="/sign-in?callbackUrl=%2Fapp%2Fpaper">
          Start in paper mode
        </Link>
      </section>

      <section className="grid">
        {pillars.map((pillar) => (
          <article className="panel" key={pillar.title}>
            <h2>{pillar.title}</h2>
            <p className="panel-copy">{pillar.body}</p>
          </article>
        ))}
      </section>

      <section className="panel roadmap">
        <div className="section-heading">
          <p className="eyebrow">Boundaries</p>
          <h2>What Kairis is not</h2>
        </div>
        <ul>
          {notList.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="panel roadmap">
        <div className="section-heading">
          <p className="eyebrow">How it works</p>
          <h2>From paper to assisted, at your pace</h2>
        </div>
        <ol className="roadmap-list step-list">
          {steps.map((step) => (
            <li className="roadmap-item" key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="site-footer">
        <p>Kairis is software, not financial advice. Crypto trading carries risk, including the loss of your funds.</p>
      </footer>
    </main>
  );
}
