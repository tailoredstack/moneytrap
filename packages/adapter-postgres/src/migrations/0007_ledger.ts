import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export const ledger: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("accounts")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("organization_id", "text", (column) => column.notNull())
      .addColumn("currency", "text", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .execute();

    await db.schema
      .createTable("journals")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("reversal_of", "text", (column) => column.unique().references("journals.id"))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .execute();

    await db.schema
      .createTable("postings")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("journal_id", "text", (column) => column.notNull().references("journals.id").onDelete("cascade"))
      .addColumn("account_id", "text", (column) => column.notNull().references("accounts.id"))
      .addColumn("side", "text", (column) => column.notNull().check(sql`side in ('debit','credit')`))
      .addColumn("amount", "bigint", (column) => column.notNull())
      .addColumn("currency", "text", (column) => column.notNull())
      .execute();

    await sql`ALTER TABLE postings ADD CONSTRAINT postings_account_currency_fk CHECK (currency = (SELECT currency FROM accounts WHERE id = account_id))`
      .execute(db)
      .catch(() => {});

    await sql`
      CREATE OR REPLACE FUNCTION ledger_journal_balanced() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM postings p
          WHERE p.journal_id = COALESCE(NEW.journal_id, OLD.journal_id)
          GROUP BY p.currency
          HAVING SUM(CASE WHEN p.side='debit' THEN p.amount ELSE -p.amount END) <> 0
        ) THEN
          RAISE EXCEPTION 'unbalanced journal';
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `.execute(db);

    await sql`
      CREATE CONSTRAINT TRIGGER postings_balance_check
      AFTER INSERT OR UPDATE OR DELETE ON postings
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      EXECUTE FUNCTION ledger_journal_balanced();
    `.execute(db);
  },

  async down(db: Kysely<unknown>) {
    await sql`DROP TRIGGER IF EXISTS postings_balance_check ON postings`.execute(db);
    await sql`DROP FUNCTION IF EXISTS ledger_journal_balanced()`.execute(db);
    await db.schema.dropTable("postings").ifExists().execute();
    await db.schema.dropTable("journals").ifExists().execute();
    await db.schema.dropTable("accounts").ifExists().execute();
  },
};
