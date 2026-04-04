import { generateJwt } from "@coinbase/cdp-sdk/auth";
import type {
  ExchangeOrderInput,
  ExchangeOrderPreviewResult,
  ExchangeOrderSubmitResult
} from "@/lib/exchange/types";

const apiHost = "api.coinbase.com";
const apiBasePath = "/api/v3/brokerage";

async function getCoinbaseBearerToken(method: string, requestPath: string) {
  const apiKeyId = process.env.COINBASE_API_KEY_ID ?? "";
  const apiKeySecret = process.env.COINBASE_API_KEY_SECRET ?? "";

  if (!apiKeyId || !apiKeySecret) {
    throw new Error("Coinbase API credentials are not configured.");
  }

  return generateJwt({
    apiKeyId,
    apiKeySecret,
    requestMethod: method,
    requestHost: apiHost,
    requestPath
  });
}

async function coinbaseFetch<TResponse>(
  method: "GET" | "POST",
  requestPath: string,
  body?: unknown
): Promise<TResponse> {
  const token = await getCoinbaseBearerToken(method, requestPath);
  const response = await fetch(`https://${apiHost}${requestPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Coinbase request failed (${response.status}): ${message}`);
  }

  return (await response.json()) as TResponse;
}

function normalizeQuoteSize(quoteSize: number) {
  return quoteSize.toFixed(2);
}

export async function previewCoinbaseOrder(
  input: ExchangeOrderInput
): Promise<ExchangeOrderPreviewResult> {
  const requestPath = `${apiBasePath}/orders/preview`;
  const payload = {
    product_id: input.productId,
    side: input.side,
    order_configuration: {
      market_market_ioc: {
        quote_size: normalizeQuoteSize(input.quoteSize)
      }
    }
  };

  type PreviewResponse = {
    order_total?: string;
    commission_total?: string;
    best_bid?: string;
    best_ask?: string;
    preview_id?: string;
    errs?: string[];
  };

  const response = await coinbaseFetch<PreviewResponse>("POST", requestPath, payload);

  return {
    provider: "coinbase",
    productId: input.productId,
    side: input.side,
    quoteSize: input.quoteSize,
    estimatedPrice: Number(response.best_ask ?? response.best_bid ?? 0),
    orderTotal: Number(response.order_total ?? input.quoteSize),
    commissionTotal: Number(response.commission_total ?? 0),
    warnings: response.errs ?? [],
    previewId: response.preview_id ?? crypto.randomUUID()
  };
}

export async function submitCoinbaseOrder(
  input: ExchangeOrderInput,
  previewId?: string
): Promise<ExchangeOrderSubmitResult> {
  const requestPath = `${apiBasePath}/orders`;
  const clientOrderId = crypto.randomUUID();

  const payload = {
    client_order_id: clientOrderId,
    product_id: input.productId,
    side: input.side,
    preview_id: previewId,
    order_configuration: {
      market_market_ioc: {
        quote_size: normalizeQuoteSize(input.quoteSize)
      }
    }
  };

  type OrderResponse = {
    success: boolean;
    success_response?: {
      order_id: string;
      client_order_id: string;
    };
    error_response?: {
      message?: string;
      error_details?: string;
    };
  };

  const response = await coinbaseFetch<OrderResponse>("POST", requestPath, payload);

  if (!response.success || !response.success_response) {
    return {
      provider: "coinbase",
      success: false,
      orderId: "",
      clientOrderId,
      detail:
        response.error_response?.error_details ??
        response.error_response?.message ??
        "Coinbase rejected the order."
    };
  }

  return {
    provider: "coinbase",
    success: true,
    orderId: response.success_response.order_id,
    clientOrderId: response.success_response.client_order_id,
    detail: `Coinbase accepted assisted order ${response.success_response.order_id}.`
  };
}

export async function getCoinbaseKeyPermissions() {
  const requestPath = `${apiBasePath}/key_permissions`;

  type PermissionsResponse = {
    can_view: boolean;
    can_trade: boolean;
    can_transfer: boolean;
    portfolio_uuid?: string;
  };

  return coinbaseFetch<PermissionsResponse>("GET", requestPath);
}
