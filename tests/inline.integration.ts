import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { LoanFixtures, type FixtureManifest } from './loanFixtures'

const payload = await getPayload({ config })
const uiPath = path.join(tmpdir(), 'libdesk-inline-ui-fixtures.json')
const mode = process.argv[2]
let fixtures: LoanFixtures | undefined
let retain = false
try {
  if (mode === 'cleanup-ui') {
    const stored = JSON.parse(await readFile(uiPath, 'utf8')) as { manifest: FixtureManifest }
    fixtures = new LoanFixtures(payload, stored.manifest)
    await fixtures.cleanup()
    fixtures = undefined
    await unlink(uiPath)
    console.log('PASS: inline UI fixtures removed; existing records preserved.')
  } else {
    assert(!mode || mode === 'prepare-ui', 'Unknown mode.')
    if (mode) await assert.rejects(readFile(uiPath), { code: 'ENOENT' })
    fixtures = new LoanFixtures(payload)
    const f = fixtures
    const librarian = await f.setup()
    const admin = await f.actor('admin', 'admin')
    const pair = await f.pair('inline')
    const second = await f.pair('shared-author')
    const author = await f.request('POST', '/authors', { name: f.manifest.prefix + 'author' })
    assert.equal(author.response.status, 201)
    const authorID: number = author.body.doc.id
    f.manifest.authors = [authorID]
    for (const book of [pair.book, second.book]) assert.equal((await f.request('PATCH', `/books/${book}`, { authors: [authorID] })).response.status, 200)
    const issuedAt = new Date(Date.now() - 86_400_000).toISOString()
    const dueAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
    const closed: number[] = []
    for (let index = 0; index < 6; index++) {
      const issued = new Date(Date.parse(issuedAt) - (7 - index) * 86_400_000).toISOString()
      const loan = await f.request('POST', '/loans', { ...pair, issuedAt: issued, dueAt, returnedAt: issuedAt })
      assert.equal(loan.response.status, 201)
      closed.push(loan.body.doc.id)
    }
    const created = await f.request('POST', '/loans', { ...pair, issuedAt, dueAt })
    assert.equal(created.response.status, 201)
    const loanID: number = created.body.doc.id
    if (mode === 'prepare-ui') {
      await writeFile(uiPath, JSON.stringify({ manifest: f.manifest, admin, librarian, ...pair, secondBook: second.book, authorID, loanID, closed, issuedAt, dueAt }), { flag: 'wx', mode: 0o600 })
      retain = true
      console.log('PASS: private inline UI fixture manifest prepared; credentials withheld.')
    } else {
      const originalBook = (await f.request('GET', `/books/${pair.book}?depth=0`)).body
      const originalMember = (await f.request('GET', `/members/${pair.member}`)).body
      for (const [role, actor] of [['admin', admin], ['librarian', librarian]] as const) {
        const name = f.manifest.prefix + role + '-inline'
        assert.equal((await f.request('PATCH', `/authors/${authorID}`, { name }, actor.token)).response.status, 200)
        for (const book of [pair.book, second.book]) {
          const read = await f.request('GET', `/books/${book}?depth=1&select[authors]=true`, undefined, actor.token)
          assert.equal(read.body.authors[0].name, name, 'Shared author must change for both books.')
        }
        const invalid = await f.request('PATCH', `/authors/${authorID}`, { name: '' }, actor.token)
        assert.equal(invalid.response.status, 400)
        assert.equal((await f.request('GET', `/authors/${authorID}`)).body.name, name)
        const updatedDue = new Date(Date.parse(dueAt) + (role === 'admin' ? 1 : 2) * 86_400_000).toISOString()
        const updated = await f.request('PATCH', `/loans/${loanID}?depth=1`, { dueAt: updatedDue }, actor.token)
        assert.equal(updated.response.status, 200)
        assert.equal(updated.body.doc.dueAt, updatedDue)
        for (const key of ['issuedAt', 'returnedAt']) assert.equal(updated.body.doc[key], created.body.doc[key])
        assert.equal(updated.body.doc.book.id, pair.book)
        assert.equal(updated.body.doc.member.id, pair.member)
        const invalidDue = await f.request('PATCH', `/loans/${loanID}`, { dueAt: issuedAt }, actor.token)
        assert.equal(invalidDue.response.status, 400)
        assert.equal((await f.request('GET', `/loans/${loanID}`)).body.dueAt, updatedDue)
        assert([403, 409].includes((await f.request('PATCH', `/loans/${closed[0]}`, { dueAt: updatedDue }, actor.token)).response.status))
        const first = await f.request('GET', `/loans?where[member][equals]=${pair.member}&limit=5&page=1&sort=-issuedAt,-id&depth=1`, undefined, actor.token)
        const next = await f.request('GET', `/loans?where[member][equals]=${pair.member}&limit=5&page=2&sort=-issuedAt,-id&depth=1`, undefined, actor.token)
        assert.equal(first.body.docs.length, 5); assert.equal(next.body.docs.length, 2)
        assert.equal(first.body.totalPages, 2)
        const all = [...first.body.docs, ...next.body.docs]
        assert.equal(new Set(all.map(doc => doc.id)).size, 7)
        assert(all.every(doc => doc.member.id === pair.member))
        console.log(`PASS: ${role}: shared author, separate dueAt update, invalid values, closed loan and pagination.`)
      }
      assert.deepEqual((await f.request('GET', `/books/${pair.book}?depth=0`)).body, originalBook, 'Inline saves must not save the parent book.')
      assert.deepEqual((await f.request('GET', `/members/${pair.member}`)).body, originalMember, 'Inline saves must not save the parent reader.')
      console.log('PASS: parent book and member remain unchanged.')
      for (const [url, data] of [[`/authors/${authorID}`, { name: f.manifest.prefix + 'attack' }], [`/loans/${loanID}`, { dueAt }]] as const) {
        assert([401, 403].includes((await f.request('PATCH', url, data, false)).response.status))
        assert([401, 403].includes((await f.request('GET', url, undefined, false)).response.status))
        const response = await fetch(`${f.baseURL}/api${url}`, { method: 'PATCH', headers: {
          'Content-Type': 'application/json', Cookie: `payload-token=${librarian.token}`, Origin: 'https://untrusted.example',
        }, body: JSON.stringify(data) })
        assert([401, 403].includes(response.status), 'Cross-origin cookie request must be refused.')
      }
      console.log('PASS: anonymous and cross-origin cookie inline operations denied.')
    }
  }
} finally {
  try {
    if (fixtures && !retain) { await fixtures.cleanup(); console.log('PASS: temporary inline records cleaned; existing data preserved.') }
  } finally { await payload.destroy() }
}
