import { createSecretBox, type SecretKeyring } from "./secret-box";

export interface SecretBoxEnvironment {
  NETWORK_SECRET_ACTIVE_KEY_ID: string | undefined;
  NETWORK_SECRET_KEYS: string | undefined;
}

// Key material is parsed in memory only. Errors identify the setting or key ID but never include input values.
export function secretKeyringFromEnv(env: SecretBoxEnvironment): SecretKeyring {
  const activeKeyId = env.NETWORK_SECRET_ACTIVE_KEY_ID;
  const rawKeys = env.NETWORK_SECRET_KEYS;
  if (!activeKeyId) throw new Error("NETWORK_SECRET_ACTIVE_KEY_ID is required");
  if (!rawKeys) throw new Error("NETWORK_SECRET_KEYS is required");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    throw new Error("NETWORK_SECRET_KEYS must be a JSON object of base64 keys");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("NETWORK_SECRET_KEYS must be a JSON object of base64 keys");
  }
  const keys = Object.entries(parsed);
  if (!keys.length) throw new Error("NETWORK_SECRET_KEYS must contain at least one key");
  const ring: SecretKeyring = {
    activeKeyId,
    keys: keys.map(([id, value]) => {
      if (!id || typeof value !== "string") throw new Error("NETWORK_SECRET_KEYS contains an invalid key entry");
      const key = Buffer.from(value, "base64");
      if (key.length !== 32 || key.toString("base64") !== value) {
        throw new Error(`NETWORK_SECRET_KEYS entry ${id} must be a canonical base64-encoded 32-byte key`);
      }
      return { id, key };
    }),
  };
  if (!ring.keys.some(({ id }) => id === activeKeyId))
    throw new Error("active network secret key ID is not configured");
  return ring;
}

export function secretBoxFromEnv(env: SecretBoxEnvironment) {
  return createSecretBox(secretKeyringFromEnv(env));
}
