export type ExchangeError = {
  code: string;
  message: string;
  retriable: boolean;
  recommendation: string;
};

export function normalizeExchangeError(error: unknown): ExchangeError {
  const message =
    error instanceof Error ? error.message : "Unknown exchange provider error.";

  if (message.includes("401") || message.includes("403")) {
    return {
      code: "auth_error",
      message,
      retriable: false,
      recommendation: "Check provider credentials, key permissions, and live-trading gating variables."
    };
  }

  if (message.includes("429")) {
    return {
      code: "rate_limited",
      message,
      retriable: true,
      recommendation: "Retry after cooldown and review exchange request volume."
    };
  }

  if (message.includes("500") || message.includes("502") || message.includes("503")) {
    return {
      code: "provider_unavailable",
      message,
      retriable: true,
      recommendation: "Pause assisted execution and retry after provider health stabilizes."
    };
  }

  return {
    code: "provider_error",
    message,
    retriable: false,
    recommendation: "Review the provider response and environment configuration before retrying."
  };
}
