import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { describeHttpFailure, ExchangeTransportError } from "@/lib/exchange/errors";
import { CoinbaseKeyFormatError, normalizeCoinbaseCredentials, type CoinbaseCredentials } from "@/lib/exchange/keys";
import type {
  Balance,
  ExchangeClient,
  ExchangeOrderStatus,
  FetchLike,
  KeyPermissions,
  OrderInput,
  OrderPreview,
  OrderStatus,
  OrderSubmitResult
} from "@/lib/exchange/types";

const apiHost = "api.coinbase.com";
const basePath = "/api/v3/brokerage";
const TIMEOUT_MS = 10_000;

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optNum(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function optStr(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function mapKeyPermissions(json: unknown): KeyPermissions {
  if (!isRecord(json)) {
    throw new Error("Malformed Coinbase key_permissions response.");
  }
  return {
    canView: json.can_view === true,
    canTrade: json.can_trade === true,
    canTransfer: json.can_transfer === true,
    portfolioUuid: optStr(json.portfolio_uuid),
    portfolioType: json.portfolio_type === "UNDEFINED" ? null : optStr(json.portfolio_type)
  };
}

export function mapBalances(json: unknown): Balance[] {
  if (!isRecord(json) || !Array.isArray(json.accounts)) {
    throw new Error("Malformed Coinbase accounts response.");
  }
  const out: Balance[] = [];
  for (const account of json.accounts as unknown[]) {
    if (!isRecord(account) || typeof account.currency !== "string") {
      continue;
    }
    const available = isRecord(account.available_balance) ? optNum(account.available_balance.value) : null;
    if (available !== null) {
      out.push({ currency: account.currency, available });
    }
  }
  return out;
}

export function mapPreview(json: unknown): OrderPreview {
  if (!isRecord(json)) {
    throw new Error("Malformed Coinbase preview response.");
  }
  return {
    previewId: optStr(json.preview_id),
    orderTotal: optNum(json.order_total) ?? 0,
    commissionTotal: optNum(json.commission_total) ?? 0,
    bestBid: optNum(json.best_bid),
    bestAsk: optNum(json.best_ask),
    warnings: [...strList(json.errs), ...strList(json.warning)]
  };
}

export function mapSubmit(json: unknown, clientOrderId: string): OrderSubmitResult {
  if (!isRecord(json)) {
    throw new Error("Malformed Coinbase create order response.");
  }
  if (json.success === false) {
    const err = isRecord(json.error_response) ? json.error_response : {};
    return {
      success: false,
      orderId: null,
      clientOrderId,
      detail:
        optStr(err.error_details) ??
        optStr(err.message) ??
        optStr(err.preview_failure_reason) ??
        "Coinbase rejected the order."
    };
  }
  const ok = isRecord(json.success_response) ? json.success_response : {};
  const orderId = optStr(ok.order_id);
  return {
    success: orderId !== null,
    orderId,
    clientOrderId: optStr(ok.client_order_id) ?? clientOrderId,
    detail: orderId ? "Coinbase accepted the order." : "Coinbase response did not include an order id."
  };
}

function mapStatus(raw: string): ExchangeOrderStatus {
  switch (raw) {
    case "FILLED":
    case "CANCELLED":
    case "EXPIRED":
    case "FAILED":
    case "OPEN":
      return raw;
    case "PENDING":
    case "QUEUED":
    case "CANCEL_QUEUED":
      return "PENDING";
    default:
      return "UNKNOWN";
  }
}

export function mapOrderStatus(json: unknown): OrderStatus {
  if (!isRecord(json) || !isRecord(json.order)) {
    throw new Error("Malformed Coinbase order response.");
  }
  const order = json.order;
  const orderId = optStr(order.order_id);
  if (orderId === null) {
    throw new Error("Malformed Coinbase order response.");
  }
  const raw = typeof order.status === "string" ? order.status : "";
  return {
    orderId,
    status: mapStatus(raw),
    filledSize: optNum(order.filled_size),
    averagePrice: optNum(order.average_filled_price),
    totalFees: optNum(order.total_fees),
    raw
  };
}

function marketOrder(input: OrderInput) {
  return { market_market_ioc: { quote_size: input.quoteUsd.toFixed(2) } };
}

export function createCoinbaseClient(
  creds: { keyId: string; secret: string },
  fetchImpl: FetchLike = fetch
): ExchangeClient {
  // Normalized on first use: a SEC1 PEM or escaped newlines would otherwise fail inside generateJwt.
  let normalized: CoinbaseCredentials | null = null;
  const credentials = () => (normalized ??= normalizeCoinbaseCredentials(creds.keyId, creds.secret));

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const { keyId, secret } = credentials();
    let token: string;
    try {
      // The uri claim is "METHOD host/path" without the query string (Coinbase JWT docs, coinbase-advanced-py format_jwt_uri).
      token = await generateJwt({
        apiKeyId: keyId,
        apiKeySecret: secret,
        requestMethod: method,
        requestHost: apiHost,
        requestPath: path.split("?")[0]
      });
    } catch {
      throw new CoinbaseKeyFormatError("The stored Coinbase key could not sign a request. Reconnect the exchange with a fresh key.");
    }
    let response: Response;
    try {
      response = await fetchImpl(`https://${apiHost}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (error) {
      if (isAbort(error)) {
        throw new ExchangeTransportError("timeout", "Coinbase did not answer within 10 s.");
      }
      throw new ExchangeTransportError("network", "Kairis could not reach Coinbase (network error).");
    }
    if (!response.ok) {
      throw describeHttpFailure(response.status, await response.text().catch(() => ""));
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ExchangeTransportError("unreadable", "Coinbase sent a response Kairis could not read.");
    }
  }

  return {
    provider: "coinbase",
    async keyPermissions() {
      return mapKeyPermissions(await request<unknown>("GET", `${basePath}/key_permissions`));
    },
    async balances() {
      return mapBalances(await request<unknown>("GET", `${basePath}/accounts?limit=250`));
    },
    async previewOrder(input) {
      const json = await request<unknown>("POST", `${basePath}/orders/preview`, {
        product_id: input.productId,
        side: input.side,
        order_configuration: marketOrder(input)
      });
      return mapPreview(json);
    },
    async createOrder(input) {
      const json = await request<unknown>("POST", `${basePath}/orders`, {
        client_order_id: input.clientOrderId,
        product_id: input.productId,
        side: input.side,
        ...(input.previewId ? { preview_id: input.previewId } : {}),
        order_configuration: marketOrder(input)
      });
      return mapSubmit(json, input.clientOrderId);
    },
    async getOrder(orderId) {
      const json = await request<unknown>(
        "GET",
        `${basePath}/orders/historical/${encodeURIComponent(orderId)}`
      );
      return mapOrderStatus(json);
    }
  };
}
