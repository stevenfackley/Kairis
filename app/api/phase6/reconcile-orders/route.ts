import { NextResponse } from "next/server";
import { reconcileAssistedOrders } from "@/lib/server/phase4-store";

export async function POST() {
  const orders = await reconcileAssistedOrders();
  return NextResponse.json({
    reconciled: orders.length
  });
}
