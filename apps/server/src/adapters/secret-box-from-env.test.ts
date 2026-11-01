import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { secretBoxFromEnv, secretKeyringFromEnv } from "./secret-box-from-env";

describe("network secret box environment", () => {
  const key = randomBytes(32);
  const env = {
    NETWORK_SECRET_ACTIVE_KEY_ID: "key-one",
    NETWORK_SECRET_KEYS: JSON.stringify({ "key-one": key.toString("base64") }),
  };

  test("builds a keyring and secret box from the active key ID and base64 keys", () => {
    expect(secretKeyringFromEnv(env).keys[0]?.key).toEqual(key);
    const box = secretBoxFromEnv(env);
    const sealed = box.seal("credential-value", "account-1");
    expect(box.open(sealed, "account-1")).toBe("credential-value");
  });

  test("rejects missing settings without exposing values", () => {
    expect(() => secretBoxFromEnv({ NETWORK_SECRET_ACTIVE_KEY_ID: undefined, NETWORK_SECRET_KEYS: undefined })).toThrow(
      "NETWORK_SECRET_ACTIVE_KEY_ID is required",
    );
    expect(() => secretBoxFromEnv({ NETWORK_SECRET_ACTIVE_KEY_ID: "key-one", NETWORK_SECRET_KEYS: undefined })).toThrow(
      "NETWORK_SECRET_KEYS is required",
    );
  });

  test("rejects malformed JSON, incorrect key lengths, and absent active key", () => {
    expect(() => secretBoxFromEnv({ ...env, NETWORK_SECRET_KEYS: "not-json" })).toThrow("JSON object");
    expect(() => secretBoxFromEnv({ ...env, NETWORK_SECRET_KEYS: JSON.stringify({ "key-one": "short" }) })).toThrow(
      "32-byte key",
    );
    expect(() => secretBoxFromEnv({ ...env, NETWORK_SECRET_ACTIVE_KEY_ID: "missing" })).toThrow("not configured");
  });
});
