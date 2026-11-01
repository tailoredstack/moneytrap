import type { StatementRecord, StatementStore } from "@moneytrap/app/src/ports/statement-store";
import type { CurrencyCode, Id } from "@moneytrap/domain";

/** In-memory reference adapter for the statement store. A closed period keeps its first statement, as the port requires. */
export class FakeStatementStore implements StatementStore {
  readonly records: StatementRecord[] = [];

  async findClosed(
    publisherId: Id<"publisher">,
    currency: CurrencyCode,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<StatementRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.publisherId === publisherId &&
          record.currency === currency &&
          record.periodStart.getTime() === periodStart.getTime() &&
          record.periodEnd.getTime() === periodEnd.getTime(),
      ) ?? null
    );
  }

  async recordClosed(record: StatementRecord): Promise<boolean> {
    if (await this.findClosed(record.publisherId, record.currency, record.periodStart, record.periodEnd)) return false;
    this.records.push({ ...record });
    return true;
  }

  async list(publisherId: Id<"publisher">): Promise<StatementRecord[]> {
    return this.records.filter((record) => record.publisherId === publisherId);
  }

  async listForOrganization(
    _userId: Id<"user"> | undefined,
    _organizationId: Id<"organization">,
  ): Promise<StatementRecord[]> {
    return [...this.records];
  }

  async findForOrganization(
    _userId: Id<"user"> | undefined,
    _organizationId: Id<"organization">,
    statementId: Id<"statement">,
  ): Promise<StatementRecord | null> {
    return this.records.find((record) => record.id === statementId) ?? null;
  }
}
