import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { normalizeExchangeError } from "@/lib/exchange/errors";
import { getAssistedProviderStatus } from "@/lib/exchange/provider";

export async function GET() {
  try {
    const provider = await getAssistedProviderStatus();

    return NextResponse.json({
      ...provider,
      assistedLiveTradingEnabled: env.assistedLiveTradingEnabled
    });
  } catch (error) {
    const normalized = normalizeExchangeError(error);
    return NextResponse.json(normalized, { status: 400 });
  }
}
