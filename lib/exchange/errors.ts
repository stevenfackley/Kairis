import { CoinbaseKeyFormatError } from "@/lib/exchange/keys";

export type ExchangeErrorCode =
  | "auth_error"
  | "forbidden"
  | "not_found"
  | "rejected"
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "network"
  | "key_format"
  | "provider_error";

export type ExchangeError = {
  code: ExchangeErrorCode;
  /** Human-readable, secret-free. Safe to show in the UI and to store in audit/detail strings. */
  message: string;
  /** Trying the same call again later can succeed (rate limit, outage, timeout). */
  retriable: boolean;
  /** The request may have been processed even though no answer arrived (timeout, 5xx). */
  ambiguous: boolean;
  status: number | null;
  recommendation: string;
};

/** Coinbase answered with a non-2xx status. The message is already a readable sentence. */
export class ExchangeHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason: string | null
  ) {
    super(message);
    this.name = "ExchangeHttpError";
  }
}

/** No usable answer: the request timed out, never connected, or came back unreadable. */
export class ExchangeTransportError extends Error {
  constructor(
    readonly kind: "timeout" | "network" | "unreadable",
    message: string
  ) {
    super(message);
    this.name = "ExchangeTransportError";
  }
}

const MAX_DETAIL = 200;

export function scrubSecrets(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(-----END [A-Z0-9 ]+-----|$)/g, "[redacted key]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted token]")
    .replace(/[A-Za-z0-9+/]{60,}={0,2}/g, "[redacted]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

/** Pulls a readable detail and the machine reason out of a Coinbase error body (JSON or text). */
function readBody(body: string): { detail: string | null; reason: string | null } {
  const text = body.trim();
  if (!text) return { detail: null, reason: null };
  try {
    const json: unknown = JSON.parse(text);
    if (isRecord(json)) {
      const first = Array.isArray(json.errors) && isRecord(json.errors[0]) ? json.errors[0] : {};
      return {
        detail: firstString(json.error_details, json.message, first.message, json.error),
        reason: firstString(json.error, first.id)
      };
    }
  } catch {
    // Plain text below.
  }
  if (text.startsWith("<")) return { detail: null, reason: null };
  return { detail: text, reason: null };
}

function phrase(status: number): string {
  if (status === 401) return "Coinbase rejected the API key";
  if (status === 403) return "Coinbase refused the request";
  if (status === 404) return "Coinbase could not find what was asked for";
  if (status === 429) return "Coinbase is rate limiting requests";
  if (status >= 500) return "Coinbase is not responding normally";
  return "Coinbase rejected the request";
}

export function describeHttpFailure(status: number, body: string): ExchangeHttpError {
  const { detail, reason } = readBody(body);
  let shown = detail ? scrubSecrets(detail).replace(/\s+/g, " ").replace(/[.\s]+$/, "") : "";
  if (shown.length > MAX_DETAIL) shown = `${shown.slice(0, MAX_DETAIL)}…`;
  return new ExchangeHttpError(status, `${phrase(status)} (HTTP ${status})${shown ? `: ${shown}` : ""}.`, reason);
}

const RECOMMENDATION: Record<ExchangeErrorCode, string> = {
  auth_error:
    "Check that the key id and private key come from the same Coinbase key, that the key is still active, and that any IP allowlist on the key includes this server.",
  forbidden: "The key lacks a permission this action needs (Kairis needs View and Trade), or the portfolio does not allow it.",
  not_found: "Check the product or order on Coinbase.",
  rejected: "Check the details above and try again.",
  rate_limited: "Wait a few seconds and try again.",
  provider_unavailable: "Try again shortly. If it persists, check status.coinbase.com.",
  timeout: "Try again shortly. If it persists, check status.coinbase.com.",
  network: "Try again shortly. If it persists, check status.coinbase.com.",
  key_format: "Reconnect the exchange with the key exactly as downloaded from Coinbase.",
  provider_error: "Review the message above before retrying."
};

function fromStatus(status: number): { code: ExchangeErrorCode; retriable: boolean; ambiguous: boolean } {
  if (status === 401) return { code: "auth_error", retriable: false, ambiguous: false };
  if (status === 403) return { code: "forbidden", retriable: false, ambiguous: false };
  if (status === 404) return { code: "not_found", retriable: false, ambiguous: false };
  if (status === 429) return { code: "rate_limited", retriable: true, ambiguous: false };
  if (status >= 500) return { code: "provider_unavailable", retriable: true, ambiguous: true };
  return { code: "rejected", retriable: false, ambiguous: false };
}

function build(code: ExchangeErrorCode, message: string, retriable: boolean, ambiguous: boolean, status: number | null): ExchangeError {
  return { code, message: scrubSecrets(message), retriable, ambiguous, status, recommendation: RECOMMENDATION[code] };
}

// Untyped errors (older call sites, tests) still carry "(401)" or "(HTTP 401)"; bare numbers do not count.
const STATUS_IN_MESSAGE = /\((?:HTTP )?([1-5]\d\d)\)/;

// Matched by name as well as class: a bundler or a test's module reset can load this file twice, and an
// unrecognised timeout must never be mistaken for a definite refusal.
function named<T extends Error>(error: unknown, cls: abstract new (...args: never[]) => T, name: string): error is T {
  return error instanceof cls || (error instanceof Error && error.name === name);
}

export function normalizeExchangeError(error: unknown): ExchangeError {
  if (named(error, ExchangeHttpError, "ExchangeHttpError") && typeof error.status === "number") {
    const s = fromStatus(error.status);
    return build(s.code, error.message, s.retriable, s.ambiguous, error.status);
  }
  if (named(error, ExchangeTransportError, "ExchangeTransportError")) {
    const code = error.kind === "timeout" ? "timeout" : error.kind === "network" ? "network" : "provider_unavailable";
    return build(code, error.message, true, true, null);
  }
  if (named(error, CoinbaseKeyFormatError, "CoinbaseKeyFormatError")) {
    return build("key_format", error.message, false, false, null);
  }
  const message = error instanceof Error && error.message ? error.message : "Unknown exchange provider error.";
  const match = STATUS_IN_MESSAGE.exec(message);
  if (match) {
    const status = Number(match[1]);
    const s = fromStatus(status);
    return build(s.code, message, s.retriable, s.ambiguous, status);
  }
  return build("provider_error", message, false, false, null);
}
