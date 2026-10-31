import type { Clock, IdGenerator } from "@moneytrap/app";
import { ID_PREFIXES, type Id, type IdKind } from "@moneytrap/domain";

// Production ports for the composition root. Domain and app code only see the interfaces.
export const systemClock: Clock = { now: () => new Date() };

// The ID body alphabet from `parseId` in @moneytrap/domain. Its 32 symbols divide 256 evenly, so a random byte
// maps to a symbol without bias.
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";

export const randomIds: IdGenerator = {
  next<K extends IdKind>(kind: K): Id<K> {
    let body = "";
    for (const byte of crypto.getRandomValues(new Uint8Array(26))) body += alphabet[byte % alphabet.length];
    return `${ID_PREFIXES[kind]}_${body}` as Id<K>;
  },
};
