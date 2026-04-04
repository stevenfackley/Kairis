import { env } from "@/lib/env";
import { getCoinbaseKeyPermissions, previewCoinbaseOrder, submitCoinbaseOrder } from "@/lib/exchange/coinbase";
import { previewMockOrder, submitMockOrder } from "@/lib/exchange/mock-exchange";
import type {
  ExchangeOrderInput,
  ExchangeOrderPreviewResult,
  ExchangeOrderSubmitResult
} from "@/lib/exchange/types";

export function getExchangeProviderName() {
  if (
    env.exchangeProvider === "coinbase" &&
    process.env.COINBASE_API_KEY_ID &&
    process.env.COINBASE_API_KEY_SECRET
  ) {
    return "coinbase" as const;
  }

  return "mock" as const;
}

export async function previewAssistedOrder(
  input: ExchangeOrderInput
): Promise<ExchangeOrderPreviewResult> {
  if (getExchangeProviderName() === "coinbase") {
    return previewCoinbaseOrder(input);
  }

  return previewMockOrder(input);
}

export async function submitAssistedOrder(
  input: ExchangeOrderInput,
  previewId?: string
): Promise<ExchangeOrderSubmitResult> {
  if (getExchangeProviderName() === "coinbase") {
    return submitCoinbaseOrder(input, previewId);
  }

  return submitMockOrder(input);
}

export async function getAssistedProviderStatus() {
  if (getExchangeProviderName() === "coinbase") {
    const permissions = await getCoinbaseKeyPermissions();
    return {
      provider: "coinbase" as const,
      canView: permissions.can_view,
      canTrade: permissions.can_trade,
      canTransfer: permissions.can_transfer,
      detail: permissions.portfolio_uuid ?? "Coinbase key connected"
    };
  }

  return {
    provider: "mock" as const,
    canView: true,
    canTrade: false,
    canTransfer: false,
    detail: "Mock provider active"
  };
}
