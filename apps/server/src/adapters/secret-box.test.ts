import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createSecretBox, type SecretKey } from "./secret-box";

const plaintext = "sk_live_9f2c7a51d0e84b3c";
const context = "nac_01arz3ndektsv4rrffq69g5fav";

const first: SecretKey = { id: "key-2026-01", key: randomBytes(32) };
const second: SecretKey = { id: "key-2026-02", key: randomBytes(32) };

describe("secret box (DM-016, WP-4.4)", () => {
  test("seals a credential under the active key ID and opens it back", () => {
    const box = createSecretBox({ activeKeyId: first.id, keys: [first] });
    const sealed = box.seal(plaintext, context);

    expect(sealed.keyId).toBe(first.id);
    expect(sealed.ciphertext).not.toContain(plaintext);
    expect(box.open(sealed, context)).toBe(plaintext);
  });

  test("two seals of the same credential differ, because each uses a fresh nonce", () => {
    const box = createSecretBox({ activeKeyId: first.id, keys: [first] });
    expect(box.seal(plaintext, context).ciphertext).not.toBe(box.seal(plaintext, context).ciphertext);
  });

  test("a ciphertext does not open under another row's context", () => {
    const box = createSecretBox({ activeKeyId: first.id, keys: [first] });
    const sealed = box.seal(plaintext, context);
    expect(() => box.open(sealed, "nac_01arz3ndektsv4rrffq69g5fbb")).toThrow("secret could not be opened");
  });

  test("a tampered ciphertext does not open, and the error carries no key material", () => {
    const box = createSecretBox({ activeKeyId: first.id, keys: [first] });
    const sealed = box.seal(plaintext, context);
    const [nonce, tag, body] = sealed.ciphertext.split(".") as [string, string, string];
    const flipped = `${nonce}.${tag}.${body.slice(0, -2)}${body.endsWith("AA") ? "BB" : "AA"}`;

    let message = "";
    try {
      box.open({ ...sealed, ciphertext: flipped }, context);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("secret could not be opened");
    expect(message).not.toContain(plaintext);
  });

  test("a truncated auth tag is refused before decryption", () => {
    const box = createSecretBox({ activeKeyId: first.id, keys: [first] });
    const sealed = box.seal(plaintext, context);
    const [nonce, tag, body] = sealed.ciphertext.split(".") as [string, string, string];
    const truncated = `${nonce}.${tag.slice(0, 8)}.${body}`;
    expect(() => box.open({ ...sealed, ciphertext: truncated }, context)).toThrow("secret could not be opened");
  });

  test("a value sealed under an old key still opens after the active key rotates", () => {
    const before = createSecretBox({ activeKeyId: first.id, keys: [first] });
    const sealed = before.seal(plaintext, context);

    const after = createSecretBox({ activeKeyId: second.id, keys: [first, second] });
    expect(after.open(sealed, context)).toBe(plaintext);
    expect(after.seal(plaintext, context).keyId).toBe(second.id);
  });

  test("a key ID that is not in the keyring cannot open the value", () => {
    const sealed = createSecretBox({ activeKeyId: first.id, keys: [first] }).seal(plaintext, context);
    const retired = createSecretBox({ activeKeyId: second.id, keys: [second] });
    expect(() => retired.open(sealed, context)).toThrow("secret key is not in the keyring");
  });

  test("a keyring with a wrong-length key, a duplicate ID, or a missing active ID is rejected", () => {
    expect(() => createSecretBox({ activeKeyId: "short", keys: [{ id: "short", key: randomBytes(16) }] })).toThrow(
      "must be 32 bytes",
    );
    expect(() => createSecretBox({ activeKeyId: first.id, keys: [first, { ...second, id: first.id }] })).toThrow(
      "defined twice",
    );
    expect(() => createSecretBox({ activeKeyId: "absent", keys: [first] })).toThrow("active secret key id");
  });
});
