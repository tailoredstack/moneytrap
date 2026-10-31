import { type Money, MoneyError } from "../money/money";

export type PostingSide = "debit" | "credit";

// One side of a balanced entry. Amounts are strictly positive; the side carries the direction (DM-040).
export class Posting {
  private constructor(
    readonly accountId: string,
    readonly side: PostingSide,
    readonly money: Money,
  ) {}

  static debit(accountId: string, money: Money): Posting {
    return Posting.of(accountId, "debit", money);
  }

  static credit(accountId: string, money: Money): Posting {
    return Posting.of(accountId, "credit", money);
  }

  private static of(accountId: string, side: PostingSide, money: Money): Posting {
    if (accountId.length === 0) {
      throw new MoneyError("posting needs an account");
    }
    if (money.amount <= 0n) {
      throw new MoneyError("posting amount must be positive");
    }
    return new Posting(accountId, side, money);
  }
}
