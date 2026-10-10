import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/sign-out/actions";
import { AppNav, type NavItem } from "@/components/app-nav";
import { BrandMark } from "@/components/brand-mark";
import { ModeBadge } from "@/components/mode-badge";
import type { CurrentUser } from "@/lib/server/session";
import type { TradeMode, TradingLimits } from "@/lib/types";

const NAV: NavItem[] = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/signals", label: "Signals" },
  { href: "/app/paper", label: "Paper" },
  { href: "/app/trade", label: "Trade" },
  { href: "/app/controls", label: "Controls" },
  { href: "/app/journal", label: "Journal" },
  { href: "/app/exchange", label: "Exchange" },
  { href: "/app/reports", label: "Reports" }
];

const OWNER_NAV: NavItem[] = [{ href: "/app/operations", label: "Operations" }];

type AppShellProps = {
  user: CurrentUser;
  limits: TradingLimits;
  mode: TradeMode;
  children: ReactNode;
};

export function AppShell({ user, limits, mode, children }: AppShellProps) {
  const items = user.isOwner ? [...NAV, ...OWNER_NAV] : NAV;
  return (
    <div className="app-root" data-mode={mode}>
      <header className="app-header">
        <Link className="app-brand" href="/app">
          <span className="app-brand-mark">
            <BrandMark compact />
          </span>
          <span>Kairis</span>
        </Link>
        <ModeBadge mode={mode} />
        <div className="app-account">
          <span className="app-account-email">{user.email ?? user.name ?? "Signed in"}</span>
          <form action={signOutAction}>
            <button type="submit" className="app-signout">
              Sign out
            </button>
          </form>
        </div>
        <AppNav items={items} />
      </header>
      {limits.tradingPaused ? (
        <div className="banner-halt" role="status">
          <strong>PAUSED</strong>
          <span>
            Trading is paused by the kill switch. Nothing can be placed until you resume it in{" "}
            <Link href="/app/controls">Controls</Link>.
          </span>
        </div>
      ) : null}
      <main className="app-main">{children}</main>
    </div>
  );
}
