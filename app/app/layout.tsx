import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getLimits } from "@/lib/server/repos/limits";
import { upsertUser } from "@/lib/server/repos/users";
import { getConnectionStatus, tradeMode } from "@/lib/server/services/exchange-connection";
import { requireUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

// Authenticates and renders the shell only. The onboarding gate lives in each page (requireOnboarded),
// because a layout does not re-run on client-side navigation.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser("/app");
  await upsertUser({ id: user.id, email: user.email, displayName: user.name, isOwner: user.isOwner });
  const [limits, connection] = await Promise.all([getLimits(user.id), getConnectionStatus(user.id)]);
  const mode = tradeMode(connection);
  return (
    <AppShell user={user} limits={limits} mode={mode}>
      {children}
    </AppShell>
  );
}
