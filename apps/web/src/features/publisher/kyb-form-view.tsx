import { Button, FormMessage } from "@moneytrap/ui";
import { type FormEvent, useRef, useState } from "react";
import { type KybValues, validateKyb } from "./kyb-form";

// SKELETONS §2.2 "KYB form". Each error sits under its field and the field points at it. Focus moves to the first
// invalid field on every submit attempt. Submit stays focusable while invalid (aria-disabled), so keyboard users can
// reach it and hear why it does nothing yet, instead of skipping over a disabled button.
// `submitAttempted` shows the errors up front, for a parent that already tried to submit.
export function KybFormView({
  values,
  submitAttempted = false,
  submitting = false,
  onDocumentSelected,
  onSubmit,
}: {
  values: KybValues;
  submitAttempted?: boolean | undefined;
  submitting?: boolean | undefined;
  onDocumentSelected?: ((file: File | null) => void) | undefined;
  onSubmit?: (() => void) | undefined;
}) {
  // The fields are controlled from here, so validation, aria-disabled, and submit all read what the user sees.
  // When the parent loads or switches the record, the fields follow it. Compared by content, so a parent that
  // rebuilds the same values on each render does not wipe what the user has typed.
  const [current, setCurrent] = useState<KybValues>(values);
  const [seen, setSeen] = useState<KybValues>(values);
  if (
    seen.legalName !== values.legalName ||
    seen.country !== values.country ||
    seen.businessType !== values.businessType
  ) {
    setSeen(values);
    setCurrent(values);
  }
  const errors = validateKyb(current);
  const invalid = Object.keys(errors).length > 0;
  // A disabled-looking Submit must say what is missing, so the reason is linked to it for screen reader users.
  const missing = [
    errors.legalName ? "legal name" : undefined,
    errors.country ? "country" : undefined,
    errors.businessType ? "business type" : undefined,
  ].filter((name): name is string => name !== undefined);
  const [attempted, setAttempted] = useState(false);
  const shown = submitAttempted || attempted ? errors : {};
  const legalNameRef = useRef<HTMLInputElement>(null);
  const countryRef = useRef<HTMLSelectElement>(null);
  const businessTypeRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalid) {
      // Every attempt re-focuses the first problem, even when the same field is still the first problem.
      setAttempted(true);
      (errors.legalName ? legalNameRef : errors.country ? countryRef : businessTypeRef).current?.focus();
      return;
    }
    if (!submitting) onSubmit?.();
  };

  return (
    <form className="max-w-xl space-y-4 text-sm" noValidate aria-busy={submitting} onSubmit={handleSubmit}>
      <h1 className="text-xl font-semibold">Business details</h1>
      <div className="block">
        <label htmlFor="kyb-legal-name">Legal name</label>
        <input
          ref={legalNameRef}
          id="kyb-legal-name"
          className="mt-1 block w-full rounded-md border p-2"
          name="legalName"
          value={current.legalName}
          onChange={(event) => setCurrent({ ...current, legalName: event.currentTarget.value })}
          aria-invalid={shown.legalName !== undefined}
          aria-describedby={shown.legalName !== undefined ? "kyb-legal-name-error" : undefined}
        />
        <FormMessage id="kyb-legal-name-error">{shown.legalName}</FormMessage>
      </div>
      <div className="block">
        <label htmlFor="kyb-country">Country</label>
        <select
          ref={countryRef}
          id="kyb-country"
          className="mt-1 block w-full rounded-md border p-2"
          name="country"
          value={current.country}
          onChange={(event) => setCurrent({ ...current, country: event.currentTarget.value })}
          aria-invalid={shown.country !== undefined}
          aria-describedby={shown.country !== undefined ? "kyb-country-error" : undefined}
        >
          <option value="">Select a country</option>
          <option value="GB">United Kingdom</option>
          <option value="US">United States</option>
        </select>
        <FormMessage id="kyb-country-error">{shown.country}</FormMessage>
      </div>
      <fieldset>
        <legend>Business type</legend>
        <label className="mr-4">
          <input
            ref={businessTypeRef}
            type="radio"
            name="businessType"
            value="individual"
            checked={current.businessType === "individual"}
            onChange={() => setCurrent({ ...current, businessType: "individual" })}
            aria-invalid={shown.businessType !== undefined}
            aria-describedby={shown.businessType !== undefined ? "kyb-business-type-error" : undefined}
          />{" "}
          Individual
        </label>
        <label>
          <input
            type="radio"
            name="businessType"
            value="company"
            checked={current.businessType === "company"}
            onChange={() => setCurrent({ ...current, businessType: "company" })}
            aria-invalid={shown.businessType !== undefined}
            aria-describedby={shown.businessType !== undefined ? "kyb-business-type-error" : undefined}
          />{" "}
          Company
        </label>
        <FormMessage id="kyb-business-type-error">{shown.businessType}</FormMessage>
      </fieldset>
      <label className="block">
        Document
        <input
          type="file"
          name="document"
          accept="application/pdf,image/png,image/jpeg"
          className="mt-1 block w-full text-sm"
          onChange={(event) => onDocumentSelected?.(event.currentTarget.files?.[0] ?? null)}
        />
        <span className="block text-muted-foreground">Stored securely; we keep a reference only.</span>
      </label>
      <Button
        type="submit"
        aria-disabled={invalid || undefined}
        aria-describedby={invalid ? "kyb-submit-hint" : undefined}
        disabled={submitting}
      >
        {submitting ? "Submitting…" : "Submit for review"}
      </Button>
      {invalid ? (
        <p id="kyb-submit-hint" className="text-muted-foreground">
          Still needed: {missing.join(", ")}.
        </p>
      ) : null}
    </form>
  );
}
