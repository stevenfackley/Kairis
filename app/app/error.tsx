"use client";

/**
 * Error boundary for every /app page. It renders inside the app shell, so the navigation and the kill
 * switch banner stay usable. Typical cause: the connection dropped while a form was submitting.
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="panel" role="alert">
      <p className="eyebrow">Something went wrong</p>
      <h1>This page could not finish loading</h1>
      <p className="panel-copy">
        The request did not complete, often because the connection dropped. If you were placing an order,
        check Trade or the Journal before trying again: an order is never sent twice, and anything that
        reached the exchange is recorded there.
      </p>
      <div className="cta-strip">
        <button className="cta-primary button-reset" onClick={() => reset()} type="button">
          Try again
        </button>
        <a className="cta-secondary" href="/app/journal">
          Open the journal
        </a>
      </div>
    </section>
  );
}
