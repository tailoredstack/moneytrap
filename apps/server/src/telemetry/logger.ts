// Structured logs. Spec §4.4: logs must not expose reusable credentials, so every entry passes through
// redact() before it is written. Redaction keys on field names and bearer strings, so a caller cannot
// opt out by naming a secret field differently.
export const REDACTED = "[REDACTED]";

// Document contents (KYB uploads, spec §4.4 and DM-010) are keyed by name too. A bare "document" key is anchored so
// it cannot catch document_reference or provider_ref, which are references and still reach the log.
const SENSITIVE_KEY =
  /token|secret|passw|authorization|cookie|api[-_]?key|credential|session|private[-_]?key|document[-_]?(?:content|bytes|body|data|blob|file)|^document$|raw[-_]?document|file[-_]?(?:content|bytes|data)/i;
// A bearer credential is masked wherever it appears, including mid-message. Userinfo in a URL
// (scheme://user:secret@host) is a credential wherever it appears too.
// Basic credentials are base64, so the length floor keeps ordinary words such as "basic plan" readable.
const BEARER = /(?:bearer\s+[^\s,;"']+|basic\s+[A-Za-z0-9+/=._-]{8,})/gi;
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^\s@]+@/gi;

function redactString(value: string): string {
  return value.replace(BEARER, REDACTED).replace(URL_USERINFO, `$1${REDACTED}@`);
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  // Only name and message are emitted. A custom property or cause is dropped rather than walked, so an allowlist decides what leaves.
  if (value instanceof Error) return { name: redact(value.name, seen), message: redact(value.message, seen) };

  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(field, seen);
  }
  return out;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSink = (line: string) => void;

export function createLogger(sink: LogSink = (line) => console.log(line)) {
  const write = (level: LogLevel, message: string, fields: Record<string, unknown> = {}) => {
    sink(JSON.stringify(redact({ ...fields, level, message })));
  };

  return {
    debug: (message: string, fields?: Record<string, unknown>) => write("debug", message, fields),
    info: (message: string, fields?: Record<string, unknown>) => write("info", message, fields),
    warn: (message: string, fields?: Record<string, unknown>) => write("warn", message, fields),
    error: (message: string, fields?: Record<string, unknown>) => write("error", message, fields),
  };
}

export type Logger = ReturnType<typeof createLogger>;
