// KYB values as the form holds them. The document is a reference chosen in the upload control, never raw bytes (WP-3.2).
export type KybValues = {
  legalName: string;
  country: string;
  businessType: "individual" | "company" | null;
};

export type KybErrors = Partial<Record<keyof KybValues, string>>;

// Required fields from SKELETONS §2.2. The messages are the ones shown next to each field.
export function validateKyb(values: KybValues): KybErrors {
  const errors: KybErrors = {};
  if (values.legalName.trim() === "") errors.legalName = "Enter the legal name.";
  if (values.country === "") errors.country = "Choose a country.";
  if (values.businessType === null) errors.businessType = "Choose a business type.";
  return errors;
}
