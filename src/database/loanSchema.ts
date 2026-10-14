import { sql, type PostgresAdapterArgs } from '@payloadcms/db-postgres'
import { uniqueIndex } from '@payloadcms/db-postgres/drizzle/pg-core'

// Declare the database rules in the schema as well as in migrations, so future
// migrate:create calls keep them instead of proposing to remove them.
export const loanReferences: NonNullable<PostgresAdapterArgs['beforeSchemaInit']>[number] = ({ adapter, schema }) => {
  for (const field of ['book', 'member']) {
    const column = adapter.rawTables.loans?.columns[field]
    if (column?.reference) {
      column.reference.onDelete = 'restrict'
      column.notNull = true
    }
  }
  return schema
}

export const loanActiveIndex: NonNullable<PostgresAdapterArgs['afterSchemaInit']>[number] = ({ adapter, extendTable, schema }) => {
  extendTable({
    table: schema.tables.loans,
    extraConfig: (table) => ({
      loans_one_active_book_idx: uniqueIndex('loans_one_active_book_idx')
        .on(table.book)
        .where(sql`${table.returnedAt} IS NULL`),
    }),
  })
  // Payload's adapter translates a racing unique violation to a field error.
  adapter.fieldConstraints.loans ??= {}
  adapter.fieldConstraints.loans.loans_one_active_book_idx = 'book'
  return schema
}
