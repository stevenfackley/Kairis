import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BrandMark } from "@/components/brand-mark";
import { safeCallbackUrl } from "@/lib/auth/paths";
import { signInAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const raw = params.callbackUrl;
  const callbackUrl = safeCallbackUrl(typeof raw === "string" ? raw : undefined);
  const session = await auth();
  if (session?.user) redirect(callbackUrl);

  return (
    <main className="page-shell narrow">
      <section className="panel sign-in">
        <BrandMark compact />
        <p className="eyebrow">Identity</p>
        <h1>Sign in to Kairis</h1>
        <p className="panel-copy">
          Kairis uses the Qavren identity service. Sign-in never asks for exchange keys, and keys you add later stay on the
          server.
        </p>
        <p className="panel-copy">
          New here? You start in paper mode. Nothing reaches an exchange until you connect a trade-only key and approve an
          order yourself.
        </p>
        <form action={signInAction}>
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button type="submit" className="cta-primary button-reset">Continue with Qavren ID</button>
        </form>
        <nav className="inline-nav">
          <Link href="/">Back to home</Link>
        </nav>
      </section>
    </main>
  );
}
