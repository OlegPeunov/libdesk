import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { type PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { Employee } from '../src/payload-types'

export type TestActor = { user: Employee; token: string; password: string }

export type FixtureManifest = {
  prefix: string
  employee?: { id: number; email: string }
  employees?: { id: number; email: string }[]
  authors?: number[]
  books: number[]
  members: number[]
  baseline?: Record<string, string>
}

/** Only this helper uses privileged SQL, to remove its own append-only test history.
 * It never disables access, hooks, indexes or foreign keys in the running app.
 */
export class LoanFixtures {
  manifest: FixtureManifest
  token = ''
  readonly db: Pick<PostgresAdapter, 'pool'>
  readonly baseURL: string

  constructor(readonly payload: Payload, manifest?: FixtureManifest) {
    this.db = { pool: payload.db.pool }
    this.manifest = manifest ?? { prefix: `LIBDESK-TEST-${randomUUID()}-`, books: [], members: [] }
    assert.match(this.manifest.prefix, /^LIBDESK-TEST-[0-9a-f-]{36}-$/)
    this.baseURL = process.env.SERVER_URL || 'http://localhost:3000'
    assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(this.baseURL).hostname), 'Tests require a local app connected to the development database.')
    assert.notEqual(process.env.NODE_ENV, 'production', 'Tests must not run in production.')
  }

  async snapshot() {
    const queries: Record<string, string> = {
      employees: 'SELECT id, name, email, role, salt, hash, created_at FROM employees ORDER BY id',
      authors: 'SELECT * FROM authors ORDER BY id',
      books: 'SELECT * FROM books ORDER BY id',
      books_rels: 'SELECT * FROM books_rels ORDER BY id',
      members: 'SELECT * FROM members ORDER BY id',
      loans: 'SELECT * FROM loans ORDER BY id',
      media: 'SELECT * FROM media ORDER BY id',
    }
    const result: Record<string, string> = {}
    for (const [table, query] of Object.entries(queries)) {
      const { rows } = await this.db.pool.query(query)
      result[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
    }
    return result
  }

  async setup() {
    this.manifest.baseline = await this.snapshot()
    const actor = await this.actor('librarian', 'staff')
    this.manifest.employee = { id: actor.user.id, email: actor.user.email }
    this.token = actor.token
    return actor
  }

  async actor(role: Employee['role'], label: string): Promise<TestActor> {
    const email = `${this.manifest.prefix.toLowerCase()}${label}@example.com`
    const password = randomUUID() + randomUUID()
    const employee = await this.payload.create({
      collection: 'employees',
      data: { name: this.manifest.prefix + label, email, password, role },
      overrideAccess: true, // Trusted fixture setup, never used by the return endpoint.
    })
    ;(this.manifest.employees ??= []).push({ id: employee.id, email })
    const login = await this.payload.login({ collection: 'employees', data: { email, password } })
    assert(login.token && login.user, 'Temporary employee must be able to log in.')
    return { user: login.user, token: login.token, password }
  }

  async request(method: string, path: string, data?: unknown, authenticated: boolean | string = true) {
    const response = await fetch(`${this.baseURL}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { Authorization: `JWT ${typeof authenticated === 'string' ? authenticated : this.token}` } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(30_000),
    })
    const body = await response.json()
    return { response, body }
  }

  async pair(label: string, authenticated: boolean | string = true) {
    const book = await this.request('POST', '/books', {
      title: `${this.manifest.prefix}${label}`,
      inventoryNumber: `${this.manifest.prefix}${label}`,
    }, authenticated)
    assert.equal(book.response.status, 201, 'Create isolated book fixture.')
    this.manifest.books.push(book.body.doc.id)
    const member = await this.request('POST', '/members', {
      name: `${this.manifest.prefix}${label}`,
      cardNumber: `${this.manifest.prefix}${label}`,
    }, authenticated)
    assert.equal(member.response.status, 201, 'Create isolated reader fixture.')
    this.manifest.members.push(member.body.doc.id)
    return { book: book.body.doc.id as number, member: member.body.doc.id as number }
  }

  async cleanup() {
    const client = await this.db.pool.connect()
    const { books, members, employee, prefix, authors = [] } = this.manifest
    const employees = [...new Map([...(this.manifest.employees ?? []), ...(employee ? [employee] : [])].map(actor => [actor.id, actor])).values()]
    try {
      await client.query('BEGIN')
      for (const [table, ids, column] of [['books', books, 'inventory_number'], ['members', members, 'card_number'], ['authors', authors, 'name']] as const) {
        const owned = await client.query(`SELECT id FROM ${table} WHERE id = ANY($1::int[]) AND left(${column}, length($2)) = $2 FOR UPDATE`, [ids, prefix])
        assert.equal(owned.rowCount, ids.length, 'Cleanup must only touch owned fixture records.')
      }
      const mixed = await client.query(`SELECT id FROM loans
        WHERE (book_id = ANY($1::int[]) OR member_id = ANY($2::int[]))
        AND NOT (book_id = ANY($1::int[]) AND member_id = ANY($2::int[]))`, [books, members])
      assert.equal(mixed.rowCount, 0, 'Refusing cleanup of history involving non-fixture records.')
      const mixedAuthors = await client.query('SELECT id FROM books_rels WHERE authors_id = ANY($1::int[]) AND NOT (parent_id = ANY($2::int[]))', [authors, books])
      assert.equal(mixedAuthors.rowCount, 0, 'Refusing cleanup of authors linked to non-fixture books.')
      await client.query(`DELETE FROM payload_locked_documents WHERE id IN (
        SELECT parent_id FROM payload_locked_documents_rels
        WHERE books_id = ANY($1::int[]) OR members_id = ANY($2::int[]) OR authors_id = ANY($3::int[])
        OR employees_id = ANY($4::int[]) AND path = 'document'
        OR loans_id IN (SELECT id FROM loans WHERE book_id = ANY($1::int[]) AND member_id = ANY($2::int[]))
      )`, [books, members, authors, employees.map(actor => actor.id)])
      await client.query('DELETE FROM loans WHERE book_id = ANY($1::int[]) AND member_id = ANY($2::int[])', [books, members])
      await client.query('DELETE FROM books WHERE id = ANY($1::int[])', [books])
      await client.query('DELETE FROM members WHERE id = ANY($1::int[])', [members])
      await client.query('DELETE FROM authors WHERE id = ANY($1::int[])', [authors])
      for (const actor of employees) {
        await client.query('DELETE FROM payload_preferences WHERE id IN (SELECT parent_id FROM payload_preferences_rels WHERE employees_id = $1)', [actor.id])
        const deleted = await client.query('DELETE FROM employees WHERE id = $1 AND email = $2 AND left(name, length($3)) = $3 RETURNING id', [actor.id, actor.email, prefix])
        assert.equal(deleted.rowCount, 1, 'Cleanup must only delete a temporary employee.')
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
    if (this.manifest.baseline) assert.deepEqual(await this.snapshot(), this.manifest.baseline, 'Existing library data must remain unchanged after tests.')
  }
}
