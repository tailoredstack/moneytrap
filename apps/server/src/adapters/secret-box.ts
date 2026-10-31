import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SealedSecret, SecretBox } from "@moneytrap/app/src/ports/secret-box";

export interface SecretKey {
  id: string;
  // 32 bytes for AES-256. Loaded from the environment or a secret store, never from the database.
  key: Buffer;
}

export interface SecretKeyring {
  activeKeyId: string;
  keys: readonly SecretKey[];
}

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

// AES-256-GCM with a fresh random nonce per seal. The key ID is stored next to the ciphertext, so older values keep
// opening after the active key changes. The row context is authenticated data, so a ciphertext copied to another row
// fails to open. Errors name no key material, plaintext, or ciphertext.
export function createSecretBox(keyring: SecretKeyring): SecretBox {
  const keys = new Map<string, Buffer>();
  for (const { id, key } of keyring.keys) {
    if (key.length !== KEY_BYTES) throw new Error(`secret key ${id} must be ${KEY_BYTES} bytes`);
    if (keys.has(id)) throw new Error(`secret key id ${id} is defined twice`);
    keys.set(id, key);
  }
  const active = keys.get(keyring.activeKeyId);
  if (!active) throw new Error("active secret key id is not in the keyring");

  return {
    seal(plaintext: string, context: string): SealedSecret {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", active, nonce);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const parts = [nonce, cipher.getAuthTag(), body].map((part) => part.toString("base64url"));
      return { keyId: keyring.activeKeyId, ciphertext: parts.join(".") };
    },

    open(sealed: SealedSecret, context: string): string {
      const key = keys.get(sealed.keyId);
      if (!key) throw new Error("secret key is not in the keyring");
      const [nonce, tag, body] = sealed.ciphertext.split(".").map((part) => Buffer.from(part, "base64url"));
      // A truncated tag would weaken authentication, so the length is checked before decryption, not left to Node.
      if (!nonce || !tag || !body || nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
        throw new Error("secret could not be opened");
      }
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
      } catch {
        throw new Error("secret could not be opened");
      }
    },
  };
}
