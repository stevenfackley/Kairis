import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { signInPath } from "@/lib/auth/paths";
import { isOwner } from "@/lib/domain/owner";
import { env } from "@/lib/env";
import { getOnboarding } from "@/lib/server/repos/onboarding";

export type CurrentUser = {
  id: string;
  email: string | null;
  name: string | null;
  roles: string[];
  isOwner: boolean;
};

export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  const email = user.email ?? null;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return { id: user.id, email, name: user.name ?? null, roles, isOwner: isOwner({ email, roles }, env.ownerEmails) };
});

export async function requireUser(callbackUrl: string): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect(signInPath(callbackUrl));
  return user;
}

export async function requireOwner(callbackUrl: string): Promise<CurrentUser> {
  const user = await requireUser(callbackUrl);
  if (!user.isOwner) notFound();
  return user;
}

/** Signed in and past the risk acknowledgment. Pages call this: layouts do not re-run on client navigation. */
export async function requireOnboarded(callbackUrl: string): Promise<CurrentUser> {
  const user = await requireUser(callbackUrl);
  const onboarding = await getOnboarding(user.id);
  if (!onboarding.riskAcknowledged) redirect("/app/onboarding");
  return user;
}
