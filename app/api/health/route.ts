import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    app: "Kairis",
    status: "ok",
    phase: "phase-2-scaffold"
  });
}
