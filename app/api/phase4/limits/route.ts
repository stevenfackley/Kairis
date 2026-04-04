import { NextResponse } from "next/server";
import { saveTradingLimits } from "@/lib/server/phase4-store";

type Payload = {
  maxPositionUsd: number;
  dailyLossCapUsd: number;
  maxTradesPerDay: number;
  cooldownMinutes: number;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as Payload;
  const limits = await saveTradingLimits(payload);
  return NextResponse.json(limits);
}
