"use server";

import { revalidatePath } from "next/cache";
import { connectCoinbase, disconnectExchange } from "@/lib/server/services/exchange-connection";
import { errorMessage } from "@/lib/server/services/shared";
import { requireOnboarded } from "@/lib/server/session";

export type ExchangeFormState = { error: string | null; connected: boolean };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

// connectCoinbase already words its errors for people. Belt and braces: never let the pasted secret
// travel back to the browser inside one.
function connectError(error: unknown, secret: string): string {
  const message = errorMessage(error, "Coinbase did not accept this key.");
  return secret ? message.split(secret).join("[redacted]") : message;
}

export async function connectExchangeAction(_prev: ExchangeFormState, formData: FormData): Promise<ExchangeFormState> {
  const user = await requireOnboarded("/app/exchange");
  const keyId = field(formData, "keyId");
  const secretPem = field(formData, "secretPem");
  if (!keyId || !secretPem) {
    return { error: "Both the API key id and the private key are required.", connected: false };
  }
  try {
    await connectCoinbase(user.id, keyId, secretPem);
  } catch (error) {
    return { error: connectError(error, secretPem), connected: false };
  }
  revalidatePath("/app", "layout");
  return { error: null, connected: true };
}

export async function disconnectExchangeAction(formData: FormData): Promise<void> {
  const user = await requireOnboarded("/app/exchange");
  if (formData.get("confirm") !== "yes") {
    return;
  }
  await disconnectExchange(user.id);
  revalidatePath("/app", "layout");
}
