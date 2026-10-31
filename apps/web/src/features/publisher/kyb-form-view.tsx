import { Button } from "@moneytrap/ui";
import { type KybValues, validateKyb } from "./kyb-form";

// SKELETONS §2.2 "KYB form". Errors are announced in a live region. Submit stays disabled until the form is valid.
export function KybFormView({
  values,
  submitAttempted = false,
  submitting = false,
}: {
  values: KybValues;
  submitAttempted?: boolean | undefined;
  submitting?: boolean | undefined;
}) {
  const errors = validateKyb(values);
  const firstError = Object.values(errors)[0];
  const canSubmit = Object.keys(errors).length === 0 && !submitting;
  return (
    <form className="max-w-xl space-y-4 text-sm" noValidate>
      <h1 className="text-xl font-semibold">Business details</h1>
      {submitAttempted && firstError ? (
        <p role="alert" className="font-medium text-destructive">
          {firstError}
        </p>
      ) : null}
      <label className="block">
        Legal name
        <input className="mt-1 block w-full rounded-md border p-2" name="legalName" defaultValue={values.legalName} />
      </label>
      <label className="block">
        Country
        <select className="mt-1 block w-full rounded-md border p-2" name="country" defaultValue={values.country}>
          <option value="">Select a country</option>
          <option value="GB">United Kingdom</option>
          <option value="US">United States</option>
        </select>
      </label>
      <fieldset>
        <legend>Business type</legend>
        <label className="mr-4">
          <input
            type="radio"
            name="businessType"
            value="individual"
            defaultChecked={values.businessType === "individual"}
          />{" "}
          Individual
        </label>
        <label>
          <input type="radio" name="businessType" value="company" defaultChecked={values.businessType === "company"} />{" "}
          Company
        </label>
      </fieldset>
      <div>
        <p>Document</p>
        <p className="text-muted-foreground">Stored securely; we keep a reference only.</p>
      </div>
      <Button type="submit" disabled={!canSubmit}>
        {submitting ? "Submitting…" : "Submit for review"}
      </Button>
    </form>
  );
}
