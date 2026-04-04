import { NextResponse } from "next/server";
import { previewAssistedOrder } from "@/lib/exchange/provider";
import { recordAssistedOrder } from "@/lib/server/phase4-store";
import type { AssistedOrderRequest } from "@/lib/types";

export async function POST(request: Request) {
  const payload = (await request.json()) as AssistedOrderRequest;
  const preview = await previewAssistedOrder(payload);

  await recordAssistedOrder({
    id: crypto.randomUUID(),
    productId: preview.productId,
    side: preview.side,
    quoteSize: preview.quoteSize,
    status: "previewed",
    provider: preview.provider,
    detail: `Previewed order total ${preview.orderTotal} with commission ${preview.commissionTotal}.`,
    createdAt: new Date().toISOString()
  });

  return NextResponse.json(preview);
}
