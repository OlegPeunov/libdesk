import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { APIError, ValidationError, type CollectionBeforeChangeHook, type PayloadRequest } from 'payload'

import type { Loan } from '../payload-types'

export const closedLoanMessage = 'Закрытую выдачу нельзя изменять или снова открывать.'

function invalid(req: PayloadRequest, path: string, message: string): never {
  throw new ValidationError({ collection: 'loans', errors: [{ path, message }], req })
}

function referenceID(value: unknown): number | undefined {
  if (value && typeof value === 'object' && 'id' in value) return referenceID(value.id)
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

function timestamp(req: PayloadRequest, path: string, value: unknown): number {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) {
    invalid(req, path, 'Укажите корректную дату и время.')
  }
  return Date.parse(value as string)
}

/** Read the latest row under the SAME transaction as Payload's eventual UPDATE. */
type StoredLoan = Pick<Loan, 'id' | 'book' | 'member' | 'issuedAt' | 'dueAt' | 'returnedAt'>

async function lockLoan(req: PayloadRequest, id: number): Promise<StoredLoan> {
  const transactionID = await req.transactionID
  // Payload's generic adapter types leave transaction sessions untyped.
  const adapter = req.payload.db as unknown as Pick<PostgresAdapter, 'sessions'>
  const db = transactionID ? adapter.sessions[String(transactionID)]?.db : undefined
  if (!db) throw new APIError('Для изменения выдачи требуется транзакция PostgreSQL.', 500)

  const result = await req.payload.db.execute({
    db,
    sql: sql`SELECT id, book_id, member_id, issued_at, due_at, returned_at
      FROM loans WHERE id = ${id} FOR UPDATE`,
  })
  const row = result.rows[0]
  if (!row) throw new APIError('Выдача не найдена.', 404)

  const iso = (value: unknown) => new Date(value as string).toISOString()
  return {
    id: Number(row.id),
    book: Number(row.book_id),
    member: Number(row.member_id),
    issuedAt: iso(row.issued_at),
    dueAt: iso(row.due_at),
    returnedAt: row.returned_at ? iso(row.returned_at) : null,
  }
}

export const enforceLoanRules: CollectionBeforeChangeHook<Loan> = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  let current: StoredLoan | undefined
  if (operation === 'update' && originalDoc) {
    current = await lockLoan(req, originalDoc.id)
    if (current.returnedAt) throw new APIError(closedLoanMessage, 409, { reason: 'loan_closed' })

    for (const field of ['book', 'member'] as const) {
      if (data[field] !== undefined && referenceID(data[field]) !== referenceID(current[field])) {
        invalid(req, field, 'После создания выдачи это поле нельзя менять.')
      }
    }
    if (data.issuedAt !== undefined && timestamp(req, 'issuedAt', data.issuedAt) !== Date.parse(current.issuedAt)) {
      invalid(req, 'issuedAt', 'После создания выдачи дату выдачи нельзя менять.')
    }
  }

  const candidate = {
    ...data,
    book: current?.book ?? data.book,
    member: current?.member ?? data.member,
    issuedAt: current?.issuedAt ?? (data.issuedAt === undefined ? new Date().toISOString() : data.issuedAt),
    dueAt: data.dueAt === undefined ? current?.dueAt : data.dueAt,
    returnedAt: data.returnedAt === undefined ? current?.returnedAt : data.returnedAt,
  }
  const issued = timestamp(req, 'issuedAt', candidate.issuedAt)
  const due = timestamp(req, 'dueAt', candidate.dueAt)
  if (due <= issued) invalid(req, 'dueAt', 'Срок возврата должен быть позже даты выдачи.')

  if (candidate.returnedAt !== null && candidate.returnedAt !== undefined && candidate.returnedAt !== '') {
    if (timestamp(req, 'returnedAt', candidate.returnedAt) < issued) {
      invalid(req, 'returnedAt', 'Дата возврата не может быть раньше даты выдачи.')
    }
  } else {
    candidate.returnedAt = null
  }

  if (!candidate.returnedAt && referenceID(candidate.book)) {
    const active = await req.payload.find({
      collection: 'loans',
      where: {
        and: [
          { book: { equals: referenceID(candidate.book) } },
          { returnedAt: { exists: false } },
          ...(current ? [{ id: { not_equals: current.id } }] : []),
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: false,
      req,
    })
    if (active.totalDocs) invalid(req, 'book', 'У этого экземпляра уже есть активная выдача.')
  }

  return candidate
}
