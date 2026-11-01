import { describe, expect, test } from "bun:test";
import { notifierFromEnv } from "./notifier-from-env";
import { NotifyDev } from "./notify-dev";
import { SmtpNotifier } from "./smtp-notifier";

describe("notifierFromEnv", () => {
  test("keeps the in-memory dev sink when SMTP_HOST is unset", () => {
    expect(notifierFromEnv({})).toBeInstanceOf(NotifyDev);
  });

  test("treats a blank SMTP_HOST as unset, so SMTP_HOST= in .env keeps the dev sink", () => {
    expect(notifierFromEnv({ SMTP_HOST: "", SMTP_FROM: "a@b.test" })).toBeInstanceOf(NotifyDev);
    expect(notifierFromEnv({ SMTP_HOST: "  " })).toBeInstanceOf(NotifyDev);
  });

  test("delivers over SMTP when SMTP_HOST is set", () => {
    expect(
      notifierFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "1025", SMTP_FROM: "no-reply@moneytrap.test" }),
    ).toBeInstanceOf(SmtpNotifier);
  });

  test("SMTP_PORT is optional and defaults to 1025", () => {
    expect(notifierFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_FROM: "no-reply@moneytrap.test" })).toBeInstanceOf(
      SmtpNotifier,
    );
  });

  test("SMTP_FROM is required once SMTP_HOST is set", () => {
    expect(() => notifierFromEnv({ SMTP_HOST: "127.0.0.1" })).toThrow("SMTP_FROM is required when SMTP_HOST is set");
    expect(() => notifierFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_FROM: " " })).toThrow("SMTP_FROM is required");
  });

  test.each(["abc", "0", "70000", "10.5", "-1"])("rejects SMTP_PORT=%s", (port) => {
    expect(() => notifierFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_PORT: port, SMTP_FROM: "a@b.test" })).toThrow(
      "SMTP_PORT must be a port number",
    );
  });

  test("ignores SMTP_PORT and SMTP_FROM when SMTP_HOST is unset", () => {
    expect(notifierFromEnv({ SMTP_PORT: "nope" })).toBeInstanceOf(NotifyDev);
  });
});
