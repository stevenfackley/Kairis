import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { normalizeExchangeError } from "@/lib/exchange/errors";
import { submitAssistedOrder } from "@/lib/exchange/provider";
import { recordAssistedOrder } from "@/lib/server/phase4-store";
import type { AssistedOrderRequest } from "@/lib/types";

type Payload = AssistedOrderRequest & {
  previewId?: string;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Payload;

    if (!env.assistedLiveTradingEnabled) {
      const blocked = await recordAssistedOrder({
        id: crypto.randomUUID(),
        productId: payload.productId,
        side: payload.side,
        quoteSize: payload.quoteSize,
        status: "blocked",
        reconcileState: "error",
        reconciledAt: new Date().toISOString(),
        provider: "mock",
        detail: "Live assisted trading is disabled by environment policy.",
        createdAt: new Date().toISOString()
      });

      return NextResponse.json(
        {
          success: false,
          detail: blocked.detail
        },
        { status: 403 }
      );
    }

    const result = await submitAssistedOrder(payload, payload.previewId);

    await recordAssistedOrder({
      id: crypto.randomUUID(),
      productId: payload.productId,
      side: payload.side,
      quoteSize: payload.quoteSize,
      status: result.success ? "submitted" : "blocked",
      reconcileState: result.success ? "pending" : "error",
      reconciledAt: result.success ? null : new Date().toISOString(),
      provider: result.provider,
      detail: result.detail,
      createdAt: new Date().toISOString()
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    const normalized = normalizeExchangeError(error);
    return NextResponse.json(normalized, { status: 400 });
  }
}
