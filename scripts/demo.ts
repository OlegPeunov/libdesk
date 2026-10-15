import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { createLocalReq, getPayload, type PayloadRequest } from 'payload'
import config from '../src/payload.config'
import { MEDIA_PREFIX } from '../src/media/image'
import { mediaKeys, r2Settings } from '../src/media/storage'
import { cover, plan } from './demo/data'

// CLI ONLY. No app hook, endpoint or request flag can invoke this maintenance path.
const args = process.argv.slice(2).filter(arg => arg !== '--')
const mode = args.shift()
const namespace = args.find(arg => arg.startsWith('--namespace='))?.slice(12) ?? 'v1'
assert(['seed', 'reset', 'check'].includes(mode ?? ''), 'Use seed, reset or check.')
assert(/^[a-z0-9][a-z0-9-]{0,23}$/.test(namespace), 'Namespace: 1–24 lowercase letters, digits or hyphens.')
assert(args.every(arg => arg === '--confirm' || arg === `--namespace=${namespace}`), 'Unknown CLI argument.')
assert(mode !== 'reset' || args.includes('--confirm'), 'Reset requires explicit --confirm; no records were changed.')
assert(process.env.NODE_ENV !== 'production', 'Demo maintenance is restricted to development.')
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.SERVER_URL || 'http://localhost:3000').hostname), 'Use the local development environment.')

type Slug = 'authors' | 'media' | 'books' | 'members' | 'loans'
const slugs: Slug[] = ['authors', 'media', 'books', 'members', 'loans']
type Entry = { id: number; createdAt: string; committed: boolean; book?: number; member?: number; issuedAt?: string; files?: string[] }
type Manifest = {
  version: 1; namespace: string; target: string; owner: string; anchor: string; state: 'seeding' | 'ready' | 'resetting'
  entries: Record<Slug, Record<string, Entry>>
}
type Row = Record<string, unknown> & { id: number; created_at: Date }
type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }>
const payload = await getPayload({ config })
const settings = r2Settings()
const s3 = new S3Client(settings.config)
const directory = path.resolve('.libdesk-demo')
const filename = path.join(directory, namespace + '.json')
const lock = await payload.db.pool.connect()
let manifest: Manifest
let saveQueue = Promise.resolve()
let locked = false
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const ids = (slug: Slug) => Object.values(manifest.entries[slug]).map(entry => entry.id)
const stem = (key: string) => `LD-DEMO-${namespace}-${manifest.owner}-${key}`
const iso = (value: unknown) => new Date(value as string).toISOString()

function assertMedia(key: string, entry: Entry, row?: Row) {
  const files = entry.files ?? []
  assert(files.length === 2 && files.every(file => file.startsWith(`${MEDIA_PREFIX}/${stem(key)}-`) && !/[\\/]/.test(file.slice(MEDIA_PREFIX.length + 1))), 'Ambiguous object ownership.')
  if (!row) return
  assert.equal(iso(row.created_at), entry.createdAt, 'Media identity changed.')
  assert(String(row.alt).startsWith(`[DEMO:${namespace}:${key}] `), `Media marker changed: ${key}.`)
  const actual = [row.filename, row.sizes_thumbnail_filename].filter(Boolean).map(name => `${MEDIA_PREFIX}/${name}`)
  assert.deepEqual(actual.sort(), [...files].sort(), 'Stored Media identity changed.')
}

async function save() {
  saveQueue = saveQueue.then(async () => {
    const temporary = filename + '.' + randomUUID() + '.tmp'
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(manifest, null, 2) + '\n'); await file.sync() }
    finally { await file.close() }
    await rename(temporary, filename)
    const folder = await open(directory, 'r')
    try { await folder.sync() } finally { await folder.close() }
  })
  await saveQueue
}

/** Only three workers, each with its own transaction and request. Settle before cleanup. */
async function limited<T>(items: T[], work: (item: T) => Promise<void>) {
  let cursor = 0
  let failed: unknown
  const workers = Array.from({ length: Math.min(3, items.length) }, async () => {
    while (cursor < items.length && !failed) {
      const item = items[cursor++]
      try { await work(item) } catch (error) { failed = error }
    }
  })
  await Promise.all(workers)
  if (failed) throw failed
}

async function snapshot() {
  const result: Record<string, string> = {}
  for (const table of ['employees', ...slugs, 'books_rels']) {
    // Never log the contents, particularly password hashes. Only compare digests.
    const query = table === 'employees'
      ? 'SELECT id, name, email, role, salt, hash, created_at FROM employees ORDER BY id'
      : table === 'books_rels'
        ? 'SELECT * FROM books_rels WHERE NOT (parent_id = ANY($1::int[])) ORDER BY id'
        : `SELECT * FROM ${table} WHERE NOT (id = ANY($1::int[])) ORDER BY id`
    const rows = await payload.db.pool.query(query, table === 'employees' ? [] : [ids(table === 'books_rels' ? 'books' : table as Slug)])
    result[table] = hash(rows.rows)
  }
  return result
}

async function rowsFor(query: Query, allowMissing: boolean) {
  const rows = {} as Record<Slug, Row[]>
  const data = plan(namespace, manifest.anchor)
  for (const slug of slugs) {
    rows[slug] = (await query(`SELECT * FROM ${slug} WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, [ids(slug)])).rows
    const byID = new Map(rows[slug].map(row => [row.id, row]))
    const keys = new Set(data[slug].map(item => item.key))
    for (const [key, entry] of Object.entries(manifest.entries[slug])) {
      assert(keys.has(key) && Number.isSafeInteger(entry.id) && entry.id > 0, 'Invalid ownership journal.')
      if (slug === 'media') assertMedia(key, entry)
      const row = byID.get(entry.id)
      if (!row) {
        assert(allowMissing || !entry.committed, `Tracked ${slug}/${key} is missing. Use explicit reset before reseeding.`)
        continue
      }
      assert.equal(iso(row.created_at), entry.createdAt, `Ambiguous identity: ${slug}/${key}; refusing changes.`)
      if (slug === 'authors') assert(String(row.name).startsWith(data.marker(key) + ' '), `Author marker changed: ${key}; refusing changes.`)
      if (slug === 'books') assert.equal(row.inventory_number, data.code(key), `Book marker changed: ${key}.`)
      if (slug === 'members') assert.equal(row.card_number, data.code(key), `Member marker changed: ${key}.`)
      if (slug === 'loans') {
        assert.equal(row.book_id, entry.book); assert.equal(row.member_id, entry.member); assert.equal(iso(row.issued_at), entry.issuedAt)
        assert(ids('books').includes(entry.book!) && ids('members').includes(entry.member!), 'Loan ownership is ambiguous.')
      }
      if (slug === 'media') {
        assertMedia(key, entry, row)
      }
    }
  }
  // A copied marker or a committed-but-unjournaled row must never be adopted or deleted.
  for (const [slug, column, prefix] of [
    ['authors', 'name', `[DEMO:${namespace}:`], ['media', 'alt', `[DEMO:${namespace}:`],
    ['books', 'inventory_number', `LD-DEMO-${namespace}-B`], ['members', 'card_number', `LD-DEMO-${namespace}-M`],
  ] as const) {
    const extra = await query(`SELECT id FROM ${slug} WHERE left(${column}, length($1)) = $1 AND NOT (id = ANY($2::int[]))`, [prefix, ids(slug)])
    assert.equal(extra.rowCount, 0, `Unjournaled ${slug} with demo marker. Ownership is ambiguous; nothing is adopted.`)
  }
  const foreignLoans = await query('SELECT id FROM loans WHERE (book_id = ANY($1::int[]) OR member_id = ANY($2::int[])) AND NOT (id = ANY($3::int[]))', [ids('books'), ids('members'), ids('loans')])
  assert.equal(foreignLoans.rowCount, 0, 'Unjournaled loan references this set; refusing maintenance.')
  return rows
}

async function outsideReferences(query: Query) {
  const authors = await query('SELECT id FROM books_rels WHERE authors_id = ANY($1::int[]) AND NOT (parent_id = ANY($2::int[]))', [ids('authors'), ids('books')])
  const media = await query('SELECT id FROM books WHERE photo_id = ANY($1::int[]) AND NOT (id = ANY($2::int[]))', [ids('media'), ids('books')])
  assert.equal((authors.rowCount ?? 0) + (media.rowCount ?? 0), 0, 'An outside book uses a demo author/photo; refusing reset.')
  const files = Object.values(manifest.entries.media).flatMap(entry => entry.files ?? []).map(file => file.slice(MEDIA_PREFIX.length + 1))
  const sharedKey = await query('SELECT id FROM media WHERE (filename = ANY($1::text[]) OR sizes_thumbnail_filename = ANY($1::text[])) AND NOT (id = ANY($2::int[]))', [files, ids('media')])
  assert.equal(sharedKey.rowCount, 0, 'An object key is shared with an outside Media record; refusing reset.')
}

async function objectList() {
  const list = await s3.send(new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: `${MEDIA_PREFIX}/LD-DEMO-${namespace}-${manifest.owner}-` }))
  assert(!list.IsTruncated, 'Unexpected number of demo objects; refusing maintenance.')
  return (list.Contents ?? []).map(object => object.Key!).sort()
}

async function checkObjects(requireAll: boolean) {
  const known = Object.values(manifest.entries.media).flatMap(entry => entry.files ?? []).sort()
  const actual = await objectList()
  assert(actual.every(key => known.includes(key)), 'Unjournaled R2 objects found. Refusing to delete ambiguous files.')
  if (requireAll) assert.deepEqual(actual, known, 'Some demo originals/thumbnails are missing from R2.')
}

try {
  // One CLI across namespaces; held by a dedicated connection until process exit.
  const acquired = await lock.query('SELECT pg_try_advisory_lock(1818845796, 1) AS locked')
  assert(acquired.rows[0].locked, 'Another demo maintenance command is running.')
  locked = true
  const targetDB = await lock.query('SELECT current_database() AS db, current_schema() AS schema')
  const connection = new URL(process.env.DATABASE_URL!)
  const target = hash([connection.host, connection.username, targetDB.rows[0], settings.bucket, settings.config.endpoint])
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try { manifest = JSON.parse(await readFile(filename, 'utf8')) as Manifest }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    assert(mode === 'seed', 'Ownership journal is missing; reset/check will not guess which rows belong to the set.')
    manifest = { version: 1, namespace, target, owner: randomUUID(), anchor: new Date().toISOString(), state: 'seeding', entries: { authors: {}, media: {}, books: {}, members: {}, loans: {} } }
    await save()
  }
  assert(manifest.version === 1 && manifest.namespace === namespace && manifest.target === target, 'Journal belongs to a different database/storage/version; refusing maintenance.')
  assert(/^[0-9a-f-]{36}$/.test(manifest.owner) && Number.isFinite(Date.parse(manifest.anchor)), 'Invalid ownership journal.')
  const admins = await payload.find({ collection: 'employees', where: { role: { equals: 'admin' } }, sort: 'id', limit: 1, depth: 0, overrideAccess: true })
  assert(admins.docs[0], 'Create the first Admin in Payload before running the demo CLI. No employees are created by seed.')
  // Trusted CLI loads the actual stored admin; no account, role, password or session is changed.
  const user = { ...admins.docs[0], collection: 'employees' as const }
  const before = await snapshot()
  const query: Query = async (text, values) => lock.query(text, values)
  let rows = await rowsFor(query, mode === 'reset')

  if (mode === 'reset') {
    await outsideReferences(query)
    await checkObjects(false)
    manifest.state = 'resetting'; await save()
    await lock.query('BEGIN')
    try {
      // Row locks prevent FK links being inserted between validation and deletion.
      rows = await rowsFor(query, true)
      await outsideReferences(query)
      const documentIDs = ['books_id', 'members_id', 'authors_id', 'loans_id', 'media_id']
      const owned = [ids('books'), ids('members'), ids('authors'), ids('loans'), ids('media')]
      await lock.query(`DELETE FROM payload_locked_documents WHERE id IN (SELECT parent_id FROM payload_locked_documents_rels WHERE ${documentIDs.map((column, i) => `${column} = ANY($${i + 1}::int[])`).join(' OR ')})`, owned)
      // Privileged, exact-ID history removal exists ONLY here. No constraints/hooks are disabled.
      for (const slug of ['loans', 'books', 'members', 'authors'] as const) await lock.query(`DELETE FROM ${slug} WHERE id = ANY($1::int[])`, [ids(slug)])
      await lock.query('COMMIT')
    } catch (error) { await lock.query('ROLLBACK'); throw error }
    // Normal Media hooks check references again and await deletion of exact original/thumbnail keys.
    await limited(Object.entries(manifest.entries.media), async ([key, entry]) => {
      const transactionID = await payload.db.beginTransaction()
      assert(transactionID)
      const req = await createLocalReq({ user }, payload)
      req.transactionID = transactionID
      try {
        const adapter = payload.db as unknown as Pick<PostgresAdapter, 'sessions'>
        const db = adapter.sessions[String(transactionID)]?.db
        assert(db)
        const lockedRow = await payload.db.execute({ db, sql: sql`SELECT * FROM media WHERE id = ${entry.id} FOR UPDATE` })
        const row = lockedRow.rows[0] as Row | undefined
        assertMedia(key, entry, row)
        if (row) await payload.delete({ collection: 'media', id: entry.id, req, overrideAccess: false })
        else for (const Key of entry.files ?? []) await s3.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key }))
        await payload.db.commitTransaction(transactionID)
      } catch (error) { await payload.db.rollbackTransaction(transactionID).catch(() => undefined); throw error }
      for (const Key of entry.files ?? []) {
        await assert.rejects(s3.send(new HeadObjectCommand({ Bucket: settings.bucket, Key })), (error: unknown) => Boolean(error && typeof error === 'object' && '$metadata' in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404))
      }
    })
    await checkObjects(false)
    assert.deepEqual(await objectList(), [], 'Some owned R2 files remain; rerun reset.')
    assert.deepEqual(await snapshot(), before, 'Non-demo records changed during reset.')
    await unlink(filename)
    console.log(`PASS: reset ${namespace}; only journaled demo records/files removed; other records unchanged.`)
  } else {
    assert(manifest.state !== 'resetting', 'Reset was interrupted. Finish seed:reset --confirm before seeding.')
    const data = plan(namespace, manifest.anchor)
    if (mode === 'seed') {
      // Resume a pending pre-commit journal entry only when the DB outcome is known.
      for (const slug of slugs) for (const [key, entry] of Object.entries(manifest.entries[slug])) {
        if (entry.committed) continue
        if (rows[slug].some(row => row.id === entry.id)) entry.committed = true
        else {
          assert(slug !== 'media', 'An interrupted Media commit needs explicit reset of journaled files first.')
          delete manifest.entries[slug][key]
        }
      }
      await save()
      let created = 0
      const create = async (slug: Slug, key: string, run: (req: PayloadRequest) => Promise<{ id: number; createdAt: string } & Parameters<typeof mediaKeys>[0]>) => {
        if (manifest.entries[slug][key]) return
        const transactionID = await payload.db.beginTransaction()
        assert(transactionID, 'PostgreSQL transactions are required.')
        const req = await createLocalReq({ user }, payload)
        req.transactionID = transactionID
        try {
          const doc = await run(req)
          const entry: Entry = { id: doc.id, createdAt: doc.createdAt, committed: false }
          if (slug === 'loans') {
            const loan = data.loans.find(item => item.key === key)!
            Object.assign(entry, { book: manifest.entries.books[loan.book].id, member: manifest.entries.members[loan.member].id, issuedAt: loan.issuedAt })
          }
          if (slug === 'media') entry.files = mediaKeys(doc)
          manifest.entries[slug][key] = entry
          // Persist the identity BEFORE commit: an acknowledged row never loses ownership metadata.
          await save()
          await payload.db.commitTransaction(transactionID)
          entry.committed = true; await save()
          created++
        } catch (error) { await payload.db.rollbackTransaction(transactionID).catch(() => undefined); throw error }
      }
      await limited(data.authors, item => create('authors', item.key, req => payload.create({ collection: 'authors', data: { name: item.name }, req, overrideAccess: false, depth: 0 })))
      console.log('Authors: 30 ready')
      await limited(data.media, item => create('media', item.key, async req => {
        const buffer = await cover(item.index)
        return payload.create({ collection: 'media', data: { alt: item.alt }, file: { data: buffer, size: buffer.length, name: stem(item.key) + '.png', mimetype: 'image/png' }, req, overrideAccess: false, depth: 0 })
      }))
      console.log('Media: 12 covers ready in R2')
      await limited(data.books, item => create('books', item.key, req => payload.create({ collection: 'books', data: {
        title: item.title, inventoryNumber: item.inventoryNumber, isbn: item.isbn,
        authors: item.authors.map(key => manifest.entries.authors[key].id), photo: item.photo ? manifest.entries.media[item.photo].id : null,
      }, req, overrideAccess: false, depth: 0 })))
      console.log('Books: 150 ready')
      await limited(data.members, item => create('members', item.key, req => payload.create({ collection: 'members', data: { name: item.name, cardNumber: item.cardNumber, email: item.email }, req, overrideAccess: false, depth: 0 })))
      console.log('Members: 80 ready')
      await limited(data.loans, item => create('loans', item.key, req => payload.create({ collection: 'loans', data: {
        book: manifest.entries.books[item.book].id, member: manifest.entries.members[item.member].id,
        issuedAt: item.issuedAt, dueAt: item.dueAt, returnedAt: item.returnedAt,
      }, req, overrideAccess: false, depth: 0 })))
      manifest.state = 'ready'; await save()
      console.log(`Seed ${namespace}: ${created} records created, ${572 - created} reused; existing demo edits preserved.`)
      rows = await rowsFor(query, false)
    }
    for (const slug of slugs) assert.equal(rows[slug].length, data[slug].length, `Unexpected ${slug} count.`)
    const rels = await lock.query('SELECT * FROM books_rels WHERE parent_id = ANY($1::int[])', [ids('books')])
    assert.equal(new Set(rows.books.map(row => row.inventory_number)).size, 150, 'Inventory numbers must be unique.')
    assert.equal(new Set(rows.members.map(row => row.card_number)).size, 80, 'Reader cards must be unique.')
    const editions = new Map<string, number>()
    for (const row of rows.books) editions.set(String(row.title) + '|' + String(row.isbn), (editions.get(String(row.title) + '|' + String(row.isbn)) ?? 0) + 1)
    assert.equal(editions.size, 30, 'Expected 30 editions.')
    assert([...editions.values()].every(count => count === 5), 'Expected five physical copies per edition.')
    assert(rels.rows.every(row => ids('authors').includes(row.authors_id)), 'Unexpected author outside this demo set.')
    assert(rows.books.every(row => !row.photo_id || ids('media').includes(Number(row.photo_id))), 'Unexpected photo outside this set.')
    const active = rows.loans.filter(row => !row.returned_at)
    assert.equal(new Set(active.map(row => row.book_id)).size, active.length, 'Duplicate active loan.')
    const index = await lock.query("SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname='loans_one_active_book_idx'")
    assert(index.rows.length === 1 && /UNIQUE.*WHERE.*returned_at.*IS NULL/i.test(index.rows[0].indexdef), 'Active-loan unique index must be present.')
    for (const row of rows.loans) {
      assert(Date.parse(String(row.due_at)) > Date.parse(String(row.issued_at)), 'Invalid loan dates.')
      assert(!row.returned_at || Date.parse(String(row.returned_at)) >= Date.parse(String(row.issued_at)), 'Invalid return date.')
      assert(ids('books').includes(Number(row.book_id)) && ids('members').includes(Number(row.member_id)), 'Loan crosses dataset boundary.')
    }
    await checkObjects(true)
    assert.deepEqual(await snapshot(), before, 'Non-demo records changed during seed/check.')
    console.log(JSON.stringify({ namespace, authors: rows.authors.length, books: rows.books.length, members: rows.members.length, loans: rows.loans.length, covers: rows.media.length,
      returned: rows.loans.length - active.length, active: active.length, overdue: active.filter(row => Date.parse(String(row.due_at)) < Date.now()).length,
      booksWithPhoto: rows.books.filter(row => row.photo_id).length, multiAuthorBooks: new Set(rels.rows.filter(row => rels.rows.filter(other => other.parent_id === row.parent_id).length > 1).map(row => row.parent_id)).size,
      r2Objects: (await objectList()).length }))
    console.log('PASS: counts, ownership, relationships, dates, active uniqueness, R2 originals/thumbnails and non-demo data preservation.')
  }
} finally {
  if (locked) await lock.query('SELECT pg_advisory_unlock(1818845796, 1)').catch(() => undefined)
  lock.release()
  s3.destroy()
  await payload.destroy()
}
