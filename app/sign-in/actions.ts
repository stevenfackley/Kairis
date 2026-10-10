"use server";

import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/auth/paths";

export async function signInAction(formData: FormData): Promise<void> {
  const raw = formData.get("callbackUrl");
  const redirectTo = safeCallbackUrl(typeof raw === "string" ? raw : undefined);
  await signIn("keycloak", { redirectTo });
}
