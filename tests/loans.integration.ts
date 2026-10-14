import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { LoanFixtures, type FixtureManifest } from './loanFixtures'

const payload = await getPayload({ config })
const uiManifestPath = path.join(tmpdir(), 'libdesk-loans-ui-fixtures.json')
const mode = process.argv[2]
let fixtures: LoanFixtures | undefined
let retainForUI = false
let failures = 0

try {
  if (mode === 'cleanup-ui') {
    fixtures = new LoanFixtures(payload, JSON.parse(await readFile(uiManifestPath, 'utf8')) as FixtureManifest)
    await fixtures.cleanup()
    fixtures = undefined
    await unlink(uiManifestPath)
    console.log('PASS: UI fixtures removed; existing library data preserved.')
  } else {
    assert(!mode || mode === 'prepare-ui', 'Unknown test mode.')
    if (mode === 'prepare-ui') {
      await assert.rejects(readFile(uiManifestPath), { code: 'ENOENT' }, 'Clean up previous UI fixtures first.')
    }
    fixtures = new LoanFixtures(payload)
    await fixtures.setup()
    const f = fixtures
    const issuedAt = new Date(Date.now() - 60_000).toISOString()
    const dueAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
    const earlier = new Date(Date.parse(issuedAt) - 1_000).toISOString()
    const issue = (pair: { book: number; member: number }, extra = {}) => f.request('POST', '/loans', { ...pair, issuedAt, dueAt, ...extra })
    const reject = (result: Awaited<ReturnType<typeof f.request>>) => assert([400, 403, 409].includes(result.response.status), 'Operation must be rejected by server rules.')
    const check = async (name: string, run: () => Promise<void>) => {
      try { await run(); console.log('PASS: ' + name) }
      catch (error) { failures++; console.error('FAIL: ' + name + ': ' + (error instanceof Error ? error.message : 'Unknown error')) }
    }

    if (mode === 'prepare-ui') {
      await f.pair('UI')
      await writeFile(uiManifestPath, JSON.stringify(f.manifest), { mode: 0o600, flag: 'wx' })
      retainForUI = true
      console.log('UI book and reader name: ' + f.manifest.prefix + 'UI')
      console.log('Cleanup command: pnpm test:loans cleanup-ui')
    } else {
      await check('free book, default issue time and due-date extension', async () => {
        const pair = await f.pair('free')
        const created = await f.request('POST', '/loans', { ...pair, dueAt })
        assert.equal(created.response.status, 201)
        assert(Math.abs(Date.now() - Date.parse(created.body.doc.issuedAt)) < 30_000)
        const updated = await f.request('PATCH', `/loans/${created.body.doc.id}`, { dueAt: new Date(Date.parse(dueAt) + 86_400_000).toISOString() })
        assert.equal(updated.response.status, 200)
      })
      await check('second active loan rejected with a book field error', async () => {
        const pair = await f.pair('duplicate')
        assert.equal((await issue(pair)).response.status, 201)
        const duplicate = await issue(pair)
        assert.equal(duplicate.response.status, 400)
        assert(duplicate.body.errors.some((error: { data?: { errors?: { path: string }[] } }) => error.data?.errors?.some(field => field.path === 'book')))
      })
      await check('two simultaneous requests: exactly one succeeds', async () => {
        const pair = await f.pair('race')
        const results = await Promise.all([issue(pair), issue(pair)])
        assert.equal(results.filter(result => result.response.status === 201).length, 1)
        reject(results.find(result => result.response.status !== 201)!)
        const stored = await f.request('GET', `/loans?where[book][equals]=${pair.book}`)
        assert.equal(stored.body.totalDocs, 1)
      })
      await check('partial unique index protects writes that bypass the pre-check', async () => {
        const pair = await f.pair('db-race')
        assert.equal((await issue(pair)).response.status, 201)
        await assert.rejects(f.db.pool.query('INSERT INTO loans (book_id, member_id, issued_at, due_at) VALUES ($1, $2, $3, $4)', [pair.book, pair.member, issuedAt, dueAt]), { code: '23505', constraint: 'loans_one_active_book_idx' })
      })
      await check('return, repeated/concurrent returns, new loan and retained history', async () => {
        const pair = await f.pair('return')
        const created = await issue(pair)
        assert.equal(created.response.status, 201)
        const id = created.body.doc.id
        const returns = await Promise.all([f.request('POST', `/loans/${id}/return`), f.request('POST', `/loans/${id}/return`)])
        assert(returns.every(result => result.response.status === 200))
        const returnedAt = returns[0].body.doc.returnedAt
        assert(returnedAt)
        assert.equal(returns[1].body.doc.returnedAt, returnedAt)
        const again = await f.request('POST', `/loans/${id}/return`)
        assert.equal(again.body.doc.returnedAt, returnedAt)
        assert.equal((await issue(pair)).response.status, 201)
        const history = await f.request('GET', `/loans?where[book][equals]=${pair.book}`)
        assert.equal(history.body.totalDocs, 2)
      })
      await check('invalid dates and missing required relationships rejected', async () => {
        const pair = await f.pair('dates')
        for (const extra of [{ dueAt: issuedAt }, { dueAt: earlier }, { returnedAt: earlier }, { issuedAt: 'invalid' }, { issuedAt: null }, { dueAt: 'invalid' }, { returnedAt: 'invalid' }, { book: null }, { member: null }]) reject(await issue(pair, extra))
        const created = await issue(pair)
        assert.equal(created.response.status, 201)
        reject(await f.request('PATCH', `/loans/${created.body.doc.id}`, { dueAt: issuedAt }))
        reject(await f.request('PATCH', `/loans/${created.body.doc.id}`, { returnedAt: earlier }))
      })
      await check('book, reader and issue time cannot change', async () => {
        const pair = await f.pair('immutable')
        const other = await f.pair('immutable-other')
        const created = await issue(pair)
        assert.equal(created.response.status, 201)
        for (const data of [{ book: other.book }, { member: other.member }, { issuedAt: earlier }]) reject(await f.request('PATCH', `/loans/${created.body.doc.id}`, data))
      })
      await check('an update waiting for a row lock cannot edit a newly closed loan', async () => {
        const pair = await f.pair('close-race')
        const created = await issue(pair)
        assert.equal(created.response.status, 201)
        const id = created.body.doc.id
        const client = await f.db.pool.connect()
        let pending: ReturnType<typeof f.request> | undefined
        const returnedAt = new Date().toISOString()
        try {
          await client.query('BEGIN')
          const holder = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
          await client.query('SELECT id FROM loans WHERE id = $1 FOR UPDATE', [id])
          pending = f.request('PATCH', `/loans/${id}`, { dueAt: new Date(Date.parse(dueAt) + 86_400_000).toISOString() })
          let blocked = false
          const deadline = Date.now() + 10_000
          while (Date.now() < deadline) {
            const waiting = await client.query('SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [holder])
            if (waiting.rowCount) { blocked = true; break }
            await setTimeout(50)
          }
          assert(blocked, 'HTTP update must wait for the loan row lock.')
          // Simulate a competing committed return while the HTTP operation has
          // already loaded the old active row. Only this fixture is changed.
          await client.query('UPDATE loans SET returned_at = $1 WHERE id = $2', [returnedAt, id])
          await client.query('COMMIT')
          reject(await pending)
          const latest = await f.request('GET', `/loans/${id}`)
          assert.equal(latest.body.returnedAt, returnedAt)
          assert.equal(latest.body.dueAt, dueAt)
        } finally {
          await client.query('ROLLBACK')
          client.release()
          await pending?.catch(() => {})
        }
      })
      await check('closed loan is read-only; history and referenced records cannot be deleted', async () => {
        const pair = await f.pair('history')
        const created = await issue(pair)
        assert.equal(created.response.status, 201)
        const id = created.body.doc.id
        assert.equal((await f.request('PATCH', `/loans/${id}`, { returnedAt: issuedAt })).response.status, 200)
        for (const data of [{ dueAt }, { returnedAt: null }, { returnedAt: dueAt }]) reject(await f.request('PATCH', `/loans/${id}`, data))
        for (const route of [`/loans/${id}`, `/books/${pair.book}`, `/members/${pair.member}`]) reject(await f.request('DELETE', route))
        const bulk = await f.request('DELETE', `/books?where[id][equals]=${pair.book}`)
        assert(bulk.response.status >= 400 || bulk.body.errors?.length > 0)
        assert.equal((await f.request('GET', `/books/${pair.book}`)).response.status, 200)
        const isRestricted = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && ['23001', '23503'].includes(String(error.code))
        await assert.rejects(f.db.pool.query('DELETE FROM books WHERE id = $1', [pair.book]), isRestricted)
        await assert.rejects(f.db.pool.query('DELETE FROM members WHERE id = $1', [pair.member]), isRestricted)
      })
      await check('anonymous create, update and return denied', async () => {
        const pair = await f.pair('auth')
        const created = await issue(pair)
        assert.equal(created.response.status, 201)
        const denied = await Promise.all([
          f.request('POST', '/loans', { ...pair, issuedAt, dueAt }, false),
          f.request('PATCH', `/loans/${created.body.doc.id}`, { returnedAt: issuedAt }, false),
          f.request('POST', `/loans/${created.body.doc.id}/return`, undefined, false),
        ])
        assert(denied.every(result => [401, 403].includes(result.response.status)))
      })
      await check('cookie authentication rejects a cross-site return request', async () => {
        const pair = await f.pair('csrf')
        const created = await issue(pair)
        assert.equal(created.response.status, 201)
        const response = await fetch(`${f.baseURL}/api/loans/${created.body.doc.id}/return`, {
          method: 'POST',
          headers: { Cookie: `${payload.config.cookiePrefix}-token=${f.token}`, Origin: 'https://attacker.example' },
          signal: AbortSignal.timeout(30_000),
        })
        assert([401, 403].includes(response.status))
        assert.equal((await f.request('GET', `/loans/${created.body.doc.id}`)).body.returnedAt, null)
      })
      await check('overdue filter is dueAt < now AND no return', async () => {
        const pair = await f.pair('overdue')
        const created = await issue(pair, { issuedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), dueAt: new Date(Date.now() - 86_400_000).toISOString() })
        assert.equal(created.response.status, 201)
        const route = `/loans?where[and][0][book][equals]=${pair.book}&where[and][1][returnedAt][exists]=false&where[and][2][dueAt][less_than]=${encodeURIComponent(new Date().toISOString())}`
        assert.equal((await f.request('GET', route)).body.totalDocs, 1)
        assert.equal((await f.request('POST', `/loans/${created.body.doc.id}/return`)).response.status, 200)
        assert.equal((await f.request('GET', route)).body.totalDocs, 0)
      })
    }
  }
} finally {
  try {
    if (fixtures && !retainForUI) {
      await fixtures.cleanup()
      console.log('PASS: All test records removed; existing library data preserved.')
    }
  } finally { await payload.destroy() }
}
if (failures) throw new Error(`${failures} loan integration checks failed.`)
