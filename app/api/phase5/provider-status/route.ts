import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getAssistedProviderStatus } from "@/lib/exchange/provider";

export async function GET() {
  const provider = await getAssistedProviderStatus();

  return NextResponse.json({
    ...provider,
    assistedLiveTradingEnabled: env.assistedLiveTradingEnabled
  });
}
