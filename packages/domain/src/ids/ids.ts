// Every entity ID is `<prefix>_<body>`. The prefix names the type, so an ID of one type cannot pass as another.
export const ID_PREFIXES = {
  user: "usr",
  organization: "org",
  publisher: "pub",
  property: "prp",
  link: "lnk",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

// A branded string: it only exists after parseId or an IdGenerator has checked the prefix.
export type Id<K extends IdKind> = string & { readonly __idKind: K };

const bodyRe = /^[0-9a-hjkmnp-tv-z]{26}$/;

// Returns the ID when the input is a string with this type's prefix and a well-formed body, otherwise null.
export function parseId<K extends IdKind>(kind: K, input: unknown): Id<K> | null {
  if (typeof input !== "string") return null;
  const prefix = `${ID_PREFIXES[kind]}_`;
  if (!input.startsWith(prefix)) return null;
  return bodyRe.test(input.slice(prefix.length)) ? (input as Id<K>) : null;
}
