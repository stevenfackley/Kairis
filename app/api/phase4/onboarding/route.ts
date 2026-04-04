import { NextResponse } from "next/server";
import { saveOnboardingState } from "@/lib/server/phase4-store";
import type { ExecutionMode } from "@/lib/types";

type Payload = {
  preferredMode: ExecutionMode;
  riskAcknowledged: boolean;
  exchangeConnected: boolean;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as Payload;
  const onboarding = await saveOnboardingState(payload);
  return NextResponse.json(onboarding);
}
