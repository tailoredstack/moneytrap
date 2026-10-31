import { describe, expect, test } from "bun:test";
import { parseKybSubmission } from "./kyb";

const valid = { entity_type: "company", company_reference: "CRN-12345678", document_reference: "vault:kyb/doc_0001" };

describe("parseKybSubmission (TP-W3-003)", () => {
  test("accepts a document reference and returns the checked fields", () => {
    const result = parseKybSubmission(valid);
    expect(result).toEqual({
      ok: true,
      value: { entityType: "company", companyReference: "CRN-12345678", documentReference: "vault:kyb/doc_0001" },
    });
  });

  test("company_reference is optional", () => {
    const result = parseKybSubmission({ entity_type: "individual", document_reference: "vault:kyb/doc_0002" });
    expect(result).toEqual({
      ok: true,
      value: { entityType: "individual", companyReference: null, documentReference: "vault:kyb/doc_0002" },
    });
  });

  test("document bytes are never read, so a bytes field is dropped from the result", () => {
    const result = parseKybSubmission({ ...valid, document: "JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmo=" });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("JVBERi0x");
  });

  test("a document sent as content instead of a reference is rejected", () => {
    const content = "%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n+/==";
    const result = parseKybSubmission({ ...valid, document_reference: content });
    expect(result).toEqual({
      ok: false,
      reason: "document_reference must be a reference from the compliance vault",
    });
  });

  test("a base64 blob without the vault prefix is rejected, even when it uses only letters and digits", () => {
    const blob = "JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmo8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoK";
    expect(parseKybSubmission({ ...valid, document_reference: blob }).ok).toBe(false);
    expect(parseKybSubmission({ ...valid, document_reference: "vault:kyb/doc_0001" }).ok).toBe(true);
  });

  test("a rejection never echoes the submitted value back", () => {
    const secretish = "PRIVATE-PASSPORT-SCAN-CONTENTS+/==";
    const result = parseKybSubmission({ ...valid, document_reference: secretish, entity_type: "" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("PASSPORT");
  });

  test("entity_type must be present and non-blank", () => {
    expect(parseKybSubmission({ ...valid, entity_type: "   " }).ok).toBe(false);
    expect(parseKybSubmission({ ...valid, entity_type: 7 }).ok).toBe(false);
  });

  test("a non-object body is rejected", () => {
    expect(parseKybSubmission(null)).toEqual({ ok: false, reason: "body must be an object" });
    expect(parseKybSubmission("kyb")).toEqual({ ok: false, reason: "body must be an object" });
  });

  test("an over-long document reference is rejected", () => {
    expect(parseKybSubmission({ ...valid, document_reference: "a".repeat(201) }).ok).toBe(false);
  });
});
