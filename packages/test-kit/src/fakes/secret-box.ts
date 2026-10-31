import type { SealedSecret, SecretBox } from "@moneytrap/app/src/ports/secret-box";

/** Reversible stand-in for the server's key-ID encryption. It is not secure and exists only to exercise callers. */
export class FakeSecretBox implements SecretBox {
  static readonly keyId = "fake-key-1";

  seal(plaintext: string, context: string): SealedSecret {
    return { keyId: FakeSecretBox.keyId, ciphertext: Buffer.from(`${context}\n${plaintext}`).toString("base64") };
  }

  open(sealed: SealedSecret, context: string): string {
    if (sealed.keyId !== FakeSecretBox.keyId) throw new Error("unknown secret key");
    const [boundContext, ...rest] = Buffer.from(sealed.ciphertext, "base64").toString("utf8").split("\n");
    if (boundContext !== context) throw new Error("secret could not be opened");
    return rest.join("\n");
  }
}
