"use client";

import { useActionState } from "react";
import { saveOnboardingAction, type OnboardingFormState } from "@/app/app/onboarding/actions";

type ModeOption = { value: "paper" | "manual" | "assisted"; title: string; body: string };

const OPTIONS: ModeOption[] = [
  {
    value: "paper",
    title: "Paper",
    body: "Simulated fills at live market prices. Nothing reaches an exchange. Recommended for everyone first."
  },
  {
    value: "manual",
    title: "Manual",
    body: "Review signals and risk checks here, then place orders yourself on your exchange."
  },
  {
    value: "assisted",
    title: "Assisted",
    body: "Kairis prepares and risk-checks each order on your exchange account. Nothing is placed until you approve it."
  }
];

const INITIAL: OnboardingFormState = { error: null };

export function OnboardingForm({ defaultMode, acknowledged }: { defaultMode: ModeOption["value"]; acknowledged: boolean }) {
  const [state, formAction, pending] = useActionState(saveOnboardingAction, INITIAL);
  return (
    <form action={formAction} className="panel onboarding-form">
      <h2>Your starting mode</h2>
      <fieldset className="field">
        <legend className="field-label">Preferred mode</legend>
        {OPTIONS.map((option) => (
          <label className="check" key={option.value}>
            <input type="radio" name="preferredMode" value={option.value} defaultChecked={option.value === defaultMode} required />
            <span>
              <strong>{option.title}.</strong> {option.body}
            </span>
          </label>
        ))}
        <span className="field-help">You can change this later. It sets your default; every order still shows its mode.</span>
      </fieldset>
      <label className="check">
        <input type="checkbox" name="riskAcknowledged" value="yes" required defaultChecked={acknowledged} />
        <span>
          I understand Kairis is software, not advice, that trading can lose money, and that I control my exchange account.
        </span>
      </label>
      {state.error ? (
        <p className="error-copy" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="button-row">
        <button type="submit" className="cta-primary button-reset" disabled={pending}>
          {pending ? "Saving..." : "Save and continue"}
        </button>
      </div>
    </form>
  );
}
