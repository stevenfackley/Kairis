export const onboardingSteps = [
  {
    step: "01",
    title: "Set your execution boundary",
    body: "Choose paper, manual, or assisted mode. The system should never hide the difference between observation and execution authority."
  },
  {
    step: "02",
    title: "Connect only what is required",
    body: "Supported exchange credentials are trade-only. Withdrawals stay disabled. The setup flow exists to prevent permission drift."
  },
  {
    step: "03",
    title: "Start in paper mode",
    body: "Users begin in simulation to learn the flow, review signals, and see how controls block unsafe actions before any live order is allowed."
  }
] as const;

export const paperMetrics = [
  { label: "Paper Balance", value: "$25,420.18", tone: "light" },
  { label: "Session P/L", value: "+$184.22", tone: "sage" },
  { label: "Daily Loss Cap", value: "$300.00", tone: "brass" },
  { label: "Mode", value: "Paper", tone: "light" }
] as const;

export const paperSignals = [
  {
    market: "BTC-USD",
    setup: "Threshold retest",
    action: "Observe",
    note: "Signal quality is acceptable, but current cooldown rules keep the account flat."
  },
  {
    market: "ETH-USD",
    setup: "Trend continuation",
    action: "Preview long",
    note: "Sizing fits the configured cap. Order remains simulated until manual or assisted live mode is enabled."
  },
  {
    market: "SOL-USD",
    setup: "Volatility spike",
    action: "Blocked",
    note: "Spread and momentum exceed the paper-mode risk thresholds."
  }
] as const;

export const exchangePolicies = [
  "Centralized exchange spot only",
  "Trade and read permissions only",
  "Withdrawals disabled",
  "Public users stay in manual or assisted execution",
  "Owner-only automation remains isolated from public entitlements"
] as const;
