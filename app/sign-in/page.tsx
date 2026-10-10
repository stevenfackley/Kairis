import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
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
    <main className="page-shell">
      <section className="page-copy">
        <p className="eyebrow">Identity</p>
        <h1>Sign in to Kairis</h1>
        <p className="lede">
          Kairis uses the Qavren identity service. Your exchange keys never leave the server, and sign-in never asks for them.
        </p>
      </section>
      <section className="panel">
        <form action={signInAction} className="panel-copy">
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
