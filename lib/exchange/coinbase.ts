import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { describeHttpFailure, ExchangeTransportError } from "@/lib/exchange/errors";
import { CoinbaseKeyFormatError, normalizeCoinbaseCredentials, type CoinbaseCredentials } from "@/lib/exchange/keys";
import { describeOrderFailure, describePreviewFailure, describePreviewWarning } from "@/lib/exchange/reasons";
import type {
  Balance,
  ExchangeClient,
  ExchangeOrderStatus,
  FetchLike,
  KeyPermissions,
  OrderInput,
  OrderLookup,
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
  return mapAccountsPage(json).balances;
}

/** One page of GET /api/v3/brokerage/accounts: { accounts, has_next, cursor, size }. */
export function mapAccountsPage(json: unknown): { balances: Balance[]; cursor: string | null } {
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
  return { balances: out, cursor: json.has_next === true ? optStr(json.cursor) : null };
}

// POST /api/v3/brokerage/orders/preview. `errs` is "List of potential failure reasons were this order to
// be submitted" (PreviewFailureReason codes): any entry means the order would be rejected.
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
    baseSize: optNum(json.base_size),
    quoteSize: optNum(json.quote_size),
    errors: strList(json.errs).map(describePreviewFailure),
    warnings: strList(json.warning)
      .map(describePreviewWarning)
      .filter((w): w is string => w !== null)
  };
}

// POST /api/v3/brokerage/orders: { success, success_response: { order_id, ... }, error_response:
// { new_order_failure_reason, error_details, message, error (deprecated), preview_failure_reason (deprecated) } }.
export function mapSubmit(json: unknown, clientOrderId: string): OrderSubmitResult {
  if (!isRecord(json)) {
    throw new Error("Malformed Coinbase create order response.");
  }
  if (json.success === false) {
    const err = isRecord(json.error_response) ? json.error_response : {};
    const reason =
      [err.new_order_failure_reason, err.preview_failure_reason, err.error, json.failure_reason]
        .map(optStr)
        .find((r): r is string => r !== null && !r.startsWith("UNKNOWN_")) ?? null;
    const said = optStr(err.error_details) ?? optStr(err.message);
    const parts = [reason ? describeOrderFailure(reason) : "", said ? `Coinbase says: "${said.replace(/[.\s]+$/, "")}".` : ""].filter(Boolean);
    return {
      success: false,
      orderId: null,
      clientOrderId,
      failureReason: reason,
      detail: parts.length > 0 ? `Coinbase rejected the order. ${parts.join(" ")}` : "Coinbase rejected the order without giving a reason."
    };
  }
  const ok = isRecord(json.success_response) ? json.success_response : {};
  const orderId = optStr(ok.order_id);
  return {
    success: orderId !== null,
    orderId,
    clientOrderId: optStr(ok.client_order_id) ?? clientOrderId,
    failureReason: null,
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
    case "EDIT_QUEUED":
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
  const status = mapStatus(raw);
  const average = optNum(order.average_filled_price);
  return {
    orderId,
    status,
    filledSize: optNum(order.filled_size),
    // average_filled_price is a required string: "0" stands for "no fills yet", not a price.
    averagePrice: average === 0 ? null : average,
    totalFees: optNum(order.total_fees),
    raw,
    // A FILLED order can still carry a stray cancel_message (seen in recorded responses); only explain non-fills.
    message: status === "FILLED" ? null : (optStr(order.reject_message) ?? optStr(order.cancel_message))
  };
}

// "To buy a product, provide a quote_size or base_size; to sell, provide a base_size" (Advanced Trade orders guide).
function marketOrder(input: OrderInput) {
  if (input.side === "SELL" && input.size.kind !== "base") {
    throw new Error("A market SELL must be sized in base currency (base_size).");
  }
  return {
    market_market_ioc: input.size.kind === "quote" ? { quote_size: input.size.quoteSize } : { base_size: input.size.baseSize }
  };
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
      // Paged by cursor; an account holds one currency and a busy user can have hundreds of them.
      const all: Balance[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 8; page += 1) {
        const query: string = cursor ? `?limit=250&cursor=${encodeURIComponent(cursor)}` : "?limit=250";
        const mapped = mapAccountsPage(await request<unknown>("GET", `${basePath}/accounts${query}`));
        all.push(...mapped.balances);
        cursor = mapped.cursor;
        if (!cursor) break;
      }
      return all;
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
    // GET orders/historical/batch has no client_order_id filter, so list the product, side and time
    // window the order could have been created in and match client_order_id here.
    async findOrderByClientId(lookup: OrderLookup) {
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const params = new URLSearchParams({
          product_ids: lookup.productId,
          order_side: lookup.side,
          start_date: lookup.createdAfter,
          end_date: lookup.createdBefore,
          limit: "100"
        });
        if (cursor) params.set("cursor", cursor);
        const json = await request<unknown>("GET", `${basePath}/orders/historical/batch?${params.toString()}`);
        if (!isRecord(json) || !Array.isArray(json.orders)) {
          throw new Error("Malformed Coinbase orders response.");
        }
        const hit = (json.orders as unknown[]).find((o) => isRecord(o) && o.client_order_id === lookup.clientOrderId);
        if (hit) {
          return mapOrderStatus({ order: hit });
        }
        cursor = json.has_next === true ? optStr(json.cursor) : null;
        if (!cursor) break;
      }
      return null;
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
