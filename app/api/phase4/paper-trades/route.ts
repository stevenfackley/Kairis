import { NextResponse } from "next/server";
import { addPaperTrade } from "@/lib/server/phase4-store";
import type { PaperTrade } from "@/lib/types";

type Payload = Omit<PaperTrade, "id" | "userId" | "createdAt">;

export async function POST(request: Request) {
  const payload = (await request.json()) as Payload;
  const trade = await addPaperTrade(payload);
  return NextResponse.json(trade);
}
