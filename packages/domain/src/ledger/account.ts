import { isCurrencyCode } from "../money/currency";
import { MoneyError } from "../money/money";

export type AccountType = "asset" | "liability" | "revenue" | "expense" | "equity";

export type AccountInput = {
  code: string;
  ownerType: string;
  ownerId: string | null;
  currency: string;
  type: AccountType;
};

// A ledger account holds one currency. Global accounts have a null owner (DM-038).
export class Account {
  private constructor(
    readonly code: string,
    readonly ownerType: string,
    readonly ownerId: string | null,
    readonly currency: string,
    readonly type: AccountType,
  ) {}

  static of(input: AccountInput): Account {
    if (input.code.length === 0) {
      throw new MoneyError("account needs a code");
    }
    if (!isCurrencyCode(input.currency)) {
      throw new MoneyError(`unknown currency ${input.currency}`);
    }
    return new Account(input.code, input.ownerType, input.ownerId, input.currency, input.type);
  }
}
