import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export default function NotFound() {
  return (
    <main className="page-shell narrow">
      <section className="panel sign-in">
        <BrandMark compact />
        <p className="eyebrow">404</p>
        <h1>That page does not exist</h1>
        <p className="panel-copy">The link may be old or mistyped. Nothing was changed.</p>
        <nav className="inline-nav">
          <Link href="/app">Go to your dashboard</Link>
          <Link href="/">Back to home</Link>
        </nav>
      </section>
    </main>
  );
}
