"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appendAudit } from "@/lib/server/repos/audit";
import { getOnboarding, saveOnboarding } from "@/lib/server/repos/onboarding";
import { requireUser } from "@/lib/server/session";
import type { ExecutionMode } from "@/lib/types";

export type OnboardingFormState = { error: string | null };

// Auto is owner-only and never offered during onboarding.
type PublicMode = Extract<ExecutionMode, "paper" | "manual" | "assisted">;
const PUBLIC_MODES: readonly PublicMode[] = ["paper", "manual", "assisted"];

function isPublicMode(value: FormDataEntryValue | null): value is PublicMode {
  return typeof value === "string" && (PUBLIC_MODES as readonly string[]).includes(value);
}

export async function saveOnboardingAction(_prev: OnboardingFormState, formData: FormData): Promise<OnboardingFormState> {
  const user = await requireUser("/app/onboarding");
  const preferredMode = formData.get("preferredMode");
  if (!isPublicMode(preferredMode)) {
    return { error: "Choose a starting mode: paper, manual or assisted." };
  }
  if (formData.get("riskAcknowledged") !== "yes") {
    return { error: "Tick the acknowledgment to continue. Kairis cannot be used without it." };
  }
  const current = await getOnboarding(user.id);
  await saveOnboarding({
    userId: user.id,
    preferredMode,
    riskAcknowledged: true,
    exchangeConnected: current.exchangeConnected,
    completedAt: null
  });
  await appendAudit(user.id, "onboarding", "saved", `Risk acknowledged; preferred mode ${preferredMode}.`);
  revalidatePath("/app", "layout");
  redirect("/app");
}
