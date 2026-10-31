// KYB submission input (spec API-022, DM-010). The platform keeps a reference to the document in the compliance
// provider's vault and never the document itself, so the input carries a reference and no document bytes.
export interface KybSubmissionInput {
  entityType: string;
  companyReference: string | null;
  documentReference: string;
}

export type KybSubmissionInputResult = { ok: true; value: KybSubmissionInput } | { ok: false; reason: string };

const ENTITY_TYPE_MAX = 64;
const COMPANY_REFERENCE_MAX = 120;
const DOCUMENT_REFERENCE_MAX = 200;
// Letters, digits, and . _ : / - only. Base64 characters such as + and = are not reference characters.
const DOCUMENT_REFERENCE_RE = /^[A-Za-z0-9._:/-]+$/;

// Checks the caller's fields. Unknown fields are not read, so a document body sent under another name never enters
// the result. A rejection names the field but never echoes its value, so a logged error cannot carry document contents.
export function parseKybSubmission(raw: unknown): KybSubmissionInputResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "body must be an object" };
  const {
    entity_type: entityType,
    company_reference: companyReference,
    document_reference: documentReference,
  } = raw as Record<string, unknown>;

  if (typeof entityType !== "string" || entityType.trim() === "" || entityType.trim().length > ENTITY_TYPE_MAX) {
    return { ok: false, reason: `entity_type must be 1 to ${ENTITY_TYPE_MAX} characters` };
  }
  if (companyReference !== undefined && companyReference !== null) {
    if (typeof companyReference !== "string" || companyReference.trim().length > COMPANY_REFERENCE_MAX) {
      return { ok: false, reason: `company_reference must be at most ${COMPANY_REFERENCE_MAX} characters` };
    }
  }
  if (
    typeof documentReference !== "string" ||
    documentReference.length > DOCUMENT_REFERENCE_MAX ||
    !DOCUMENT_REFERENCE_RE.test(documentReference)
  ) {
    return { ok: false, reason: "document_reference must be a reference from the compliance vault" };
  }

  const trimmedCompany = typeof companyReference === "string" ? companyReference.trim() : "";
  return {
    ok: true,
    value: {
      entityType: entityType.trim(),
      companyReference: trimmedCompany === "" ? null : trimmedCompany,
      documentReference,
    },
  };
}
