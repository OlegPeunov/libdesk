import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLocalReq, getPayload, type CollectionSlug } from 'payload'
import config from '../src/payload.config'
import { returnLoan } from '../src/loans/returnLoan'
import { LoanFixtures, type FixtureManifest, type TestActor } from './loanFixtures'

const payload = await getPayload({ config })
const uiPath = path.join(tmpdir(), 'libdesk-access-ui-fixtures.json')
const mode = process.argv[2]
let fixtures: LoanFixtures | undefined
let retainForUI = false
let failures = 0

try {
  if (mode === 'cleanup-ui') {
    const stored = JSON.parse(await readFile(uiPath, 'utf8')) as { manifest: FixtureManifest }
    fixtures = new LoanFixtures(payload, stored.manifest)
    await fixtures.cleanup()
    fixtures = undefined
    await unlink(uiPath)
    console.log('PASS: role UI fixtures removed; existing library data preserved.')
  } else {
    assert(!mode || mode === 'prepare-ui', 'Unknown test mode.')
    if (mode === 'prepare-ui') await assert.rejects(readFile(uiPath), { code: 'ENOENT' })
    fixtures = new LoanFixtures(payload)
    const f = fixtures
    const librarian = await f.setup()
    const admin = await f.actor('admin', 'admin')
    const other = await f.actor('librarian', 'other')
    const issuedAt = new Date(Date.now() - 60_000).toISOString()
    const dueAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
    const userFor = async (actor?: TestActor) => {
      if (!actor) return undefined
      const auth = await payload.auth({ headers: new Headers({ Authorization: `JWT ${actor.token}` }) })
      assert(auth.user, 'Fixture authentication must succeed.')
      return auth.user
    }
    const forbidden = async (run: () => Promise<unknown>) => {
      await assert.rejects(run, (error: unknown) => typeof error === 'object' && error !== null && 'status' in error && [401, 403, 409].includes(Number(error.status)))
    }
    const denied = (result: Awaited<ReturnType<typeof f.request>>) => assert([401, 403, 409].includes(result.response.status), 'REST operation must be denied.')
    const check = async (name: string, run: () => Promise<void>) => {
      try { await run(); console.log('PASS: ' + name) }
      catch (error) { failures++; console.error('FAIL: ' + name + ': ' + (error instanceof Error ? error.message : 'Unknown error')) }
    }
    const forget = (slug: 'authors' | 'books' | 'members', id: number) => {
      f.manifest[slug] = (f.manifest[slug] ?? []).filter(value => value !== id)
    }

    if (mode === 'prepare-ui') {
      const pair = await f.pair('roles-UI')
      const loan = await f.request('POST', '/loans', { ...pair, issuedAt, dueAt }, admin.token)
      assert.equal(loan.response.status, 201)
      // These are disposable fixture credentials, never the owner's password.
      // Do not print them, and remove the private file after the browser check.
      await writeFile(uiPath, JSON.stringify({ manifest: f.manifest, admin, librarian, loanID: loan.body.doc.id }), { flag: 'wx', mode: 0o600 })
      retainForUI = true
      console.log('Role UI fixtures prepared. Credentials are in a private temporary file; values withheld.')
    } else {
      for (const [role, actor] of [['admin', admin], ['librarian', librarian]] as const) {
        await check(`${role}: REST catalog CRUD, population and delete permissions`, async () => {
          const author = await f.request('POST', '/authors', { name: f.manifest.prefix + role + '-REST-author' }, actor.token)
          assert.equal(author.response.status, 201)
          const authorID = author.body.doc.id as number
          ;(f.manifest.authors ??= []).push(authorID)
          const pair = await f.pair(role + '-REST', actor.token)
          assert.equal((await f.request('PATCH', `/books/${pair.book}`, { authors: [authorID] }, actor.token)).response.status, 200)
          assert.equal((await f.request('PATCH', `/authors/${authorID}`, { name: f.manifest.prefix + role + '-REST-edited' }, actor.token)).response.status, 200)
          assert.equal((await f.request('PATCH', `/members/${pair.member}`, { email: 'fixture@example.com' }, actor.token)).response.status, 200)
          const populated = await f.request('GET', `/books/${pair.book}?depth=3&populate[authors][name]=true`, undefined, actor.token)
          assert.equal(populated.response.status, 200)
          assert.equal(populated.body.authors[0].id, authorID)
          assert.equal((await f.request('GET', `/members/${pair.member}`, undefined, actor.token)).response.status, 200)
          for (const [slug, id] of [['books', pair.book], ['members', pair.member], ['authors', authorID]] as const) {
            const deletion = await f.request('DELETE', `/${slug}/${id}`, undefined, actor.token)
            if (role === 'admin') { assert.equal(deletion.response.status, 200); forget(slug, id) }
            else denied(deletion)
          }
        })
        await check(`${role}: Local API catalog access with overrideAccess false`, async () => {
          const user = await userFor(actor)
          const author = await payload.create({ collection: 'authors', data: { name: f.manifest.prefix + role + '-local-author' }, user, overrideAccess: false })
          ;(f.manifest.authors ??= []).push(author.id)
          const book = await payload.create({ collection: 'books', data: { title: f.manifest.prefix + role, inventoryNumber: f.manifest.prefix + role + '-local', authors: [author.id] }, user, overrideAccess: false })
          f.manifest.books.push(book.id)
          const member = await payload.create({ collection: 'members', data: { name: f.manifest.prefix + role, cardNumber: f.manifest.prefix + role + '-local' }, user, overrideAccess: false })
          f.manifest.members.push(member.id)
          const populated = await payload.findByID({ collection: 'books', id: book.id, depth: 3, populate: { authors: { name: true } }, user, overrideAccess: false })
          assert.equal(typeof populated.authors?.[0], 'object')
          await payload.update({ collection: 'authors', id: author.id, data: { name: f.manifest.prefix + role + '-local-edited' }, user, overrideAccess: false })
          await payload.update({ collection: 'books', id: book.id, data: { title: f.manifest.prefix + role + '-edited' }, user, overrideAccess: false })
          await payload.update({ collection: 'members', id: member.id, data: { email: 'fixture@example.com' }, user, overrideAccess: false })
          for (const [slug, id] of [['books', book.id], ['members', member.id], ['authors', author.id]] as const) {
            const remove = () => payload.delete({ collection: slug, id, user, overrideAccess: false })
            if (role === 'admin') { await remove(); forget(slug, id) }
            else await forbidden(remove)
          }
        })
        await check(`${role}: REST loan/return and protected closed history`, async () => {
          const pair = await f.pair(role + '-loans', actor.token)
          const loan = await f.request('POST', '/loans', { ...pair, issuedAt, dueAt }, actor.token)
          assert.equal(loan.response.status, 201)
          const id = loan.body.doc.id
          const populated = await f.request('GET', `/loans/${id}?depth=3&populate[books][title]=true&populate[members][name]=true`, undefined, actor.token)
          assert.equal(populated.body.book.id, pair.book)
          assert.equal(populated.body.member.id, pair.member)
          assert.equal((await f.request('PATCH', `/loans/${id}`, { dueAt }, actor.token)).response.status, 200)
          assert.equal((await f.request('POST', `/loans/${id}/return`, undefined, actor.token)).response.status, 200)
          denied(await f.request('PATCH', `/loans/${id}`, { returnedAt: null }, actor.token))
          for (const route of [`/loans/${id}`, `/books/${pair.book}`, `/members/${pair.member}`]) denied(await f.request('DELETE', route, undefined, actor.token))
        })
        await check(`${role}: Local API loans, return endpoint and protected history`, async () => {
          const user = await userFor(actor)
          const pair = await f.pair(role + '-local-loans')
          const loan = await payload.create({ collection: 'loans', data: { ...pair, issuedAt, dueAt }, user, overrideAccess: false })
          const populated = await payload.findByID({ collection: 'loans', id: loan.id, depth: 2, user, overrideAccess: false })
          assert.equal(typeof populated.book, 'object')
          assert.equal(typeof populated.member, 'object')
          const req = await createLocalReq({ user }, payload)
          req.routeParams = { id: String(loan.id) }
          const response = await returnLoan.handler(req)
          assert.equal(response.status, 200)
          await forbidden(() => payload.update({ collection: 'loans', id: loan.id, data: { dueAt }, user, overrideAccess: false }))
          for (const [slug, id] of [['loans', loan.id], ['books', pair.book], ['members', pair.member]] as const) await forbidden(() => payload.delete({ collection: slug, id, user, overrideAccess: false }))
        })
      }

      await check('admin: create default librarian, manage another role and delete another account', async () => {
        const email = f.manifest.prefix.toLowerCase() + 'created@example.com'
        const created = await f.request('POST', '/employees', { name: f.manifest.prefix + 'created', email, password: randomUUID() + randomUUID() }, admin.token)
        assert.equal(created.response.status, 201)
        assert.equal(created.body.doc.role, 'librarian')
        const id = created.body.doc.id as number
        f.manifest.employees!.push({ id, email })
        assert.equal((await f.request('PATCH', `/employees/${id}`, { role: 'admin' }, admin.token)).response.status, 200)
        assert.equal((await f.request('GET', `/employees/${id}`, undefined, admin.token)).body.role, 'admin')
        assert.equal((await f.request('DELETE', `/employees/${id}`, undefined, admin.token)).response.status, 200)
        f.manifest.employees = f.manifest.employees!.filter(actor => actor.id !== id)
        const user = await userFor(admin)
        const local = await payload.create({ collection: 'employees', data: { name: f.manifest.prefix + 'local-created', email: f.manifest.prefix.toLowerCase() + 'local-created@example.com', password: randomUUID(), role: 'librarian' }, user, overrideAccess: false })
        f.manifest.employees!.push({ id: local.id, email: local.email })
        await payload.delete({ collection: 'employees', id: local.id, user, overrideAccess: false })
        f.manifest.employees = f.manifest.employees!.filter(actor => actor.id !== local.id)
        await payload.update({ collection: 'employees', id: other.user.id, data: { role: 'admin' }, user, overrideAccess: false })
        assert.equal((await payload.findByID({ collection: 'employees', id: other.user.id, user, overrideAccess: false })).role, 'admin')
        await payload.update({ collection: 'employees', id: other.user.id, data: { role: 'librarian' }, user, overrideAccess: false })
      })
      await check('librarian: only own account is visible; another account and employee creation denied', async () => {
        const list = await f.request('GET', '/employees?depth=5', undefined, librarian.token)
        assert.equal(list.body.totalDocs, 1)
        assert.equal(list.body.docs[0].id, librarian.user.id)
        assert.equal((await f.request('GET', `/employees/${librarian.user.id}`, undefined, librarian.token)).response.status, 200)
        denied(await f.request('GET', `/employees/${admin.user.id}?depth=5&populate[employees][role]=true`, undefined, librarian.token))
        denied(await f.request('PATCH', `/employees/${admin.user.id}`, { name: f.manifest.prefix + 'attack' }, librarian.token))
        denied(await f.request('POST', '/employees', { name: f.manifest.prefix + 'attack', email: f.manifest.prefix.toLowerCase() + 'attack@example.com', password: randomUUID(), role: 'admin' }, librarian.token))
        const user = await userFor(librarian)
        const own = await payload.find({ collection: 'employees', user, overrideAccess: false, depth: 5 })
        assert.equal(own.totalDocs, 1)
        assert.equal(own.docs[0].id, librarian.user.id)
        await forbidden(() => payload.findByID({ collection: 'employees', id: admin.user.id, user, overrideAccess: false, depth: 5 }))
        await forbidden(() => payload.update({ collection: 'employees', id: admin.user.id, data: { name: 'attack' }, user, overrideAccess: false }))
        await forbidden(() => payload.create({ collection: 'employees', data: { name: 'attack', email: 'attack@example.com', password: randomUUID(), role: 'admin' }, user, overrideAccess: false }))
      })
      await check('librarian: own name and framework-hashed password can change', async () => {
        const name = f.manifest.prefix + 'own-name'
        const restPassword = randomUUID() + randomUUID()
        assert.equal((await f.request('PATCH', `/employees/${librarian.user.id}`, { name, password: restPassword }, librarian.token)).response.status, 200)
        const restLogin = await payload.login({ collection: 'employees', data: { email: librarian.user.email, password: restPassword } })
        assert(restLogin.token && restLogin.user)
        librarian.token = restLogin.token
        const password = randomUUID() + randomUUID()
        await payload.update({ collection: 'employees', id: librarian.user.id, data: { name, password }, user: await userFor(librarian), overrideAccess: false })
        const login = await payload.login({ collection: 'employees', data: { email: librarian.user.email, password } })
        assert(login.token && login.user)
        librarian.token = login.token
        f.token = login.token
        librarian.password = password
        assert.equal(login.user.name, name)
        assert.equal(login.user.role, 'librarian')
      })
      await check('direct role escalation, query/context tricks and self-demotion denied', async () => {
        for (const actor of [admin, librarian]) {
          denied(await f.request('PATCH', `/employees/${actor.user.id}?overrideAccess=true&context[isAdmin]=true`, { role: actor === admin ? 'librarian' : 'admin', context: { isAdmin: true } }, actor.token))
          await forbidden(() => payload.update({ collection: 'employees', id: actor.user.id, data: { role: actor === admin ? 'librarian' : 'admin' }, user: actor.user, overrideAccess: false, context: { isAdmin: true } }))
          assert.equal((await f.request('GET', `/employees/${actor.user.id}`, undefined, actor.token)).body.role, actor.user.role)
          denied(await f.request('DELETE', `/employees/${actor.user.id}`, undefined, actor.token))
          await forbidden(() => payload.delete({ collection: 'employees', id: actor.user.id, user: actor.user, overrideAccess: false }))
        }
        denied(await f.request('PATCH', `/employees/${librarian.user.id}`, { email: 'changed@example.com' }, librarian.token))
        const bulkRole = await f.request('PATCH', `/employees?where[id][equals]=${admin.user.id}`, { role: 'librarian' }, admin.token)
        assert.equal(bulkRole.body.docs.length, 0)
        const bulkDelete = await f.request('DELETE', `/employees?where[id][equals]=${admin.user.id}`, undefined, admin.token)
        assert.equal(bulkDelete.body.docs.length, 0)
        assert.equal((await f.request('GET', `/employees/${admin.user.id}`, undefined, admin.token)).body.role, 'admin')
        denied(await f.request('PATCH', `/employees?where[id][equals]=${librarian.user.id}`, { role: 'admin' }, librarian.token))
      })
      await check('anonymous: every collection denies REST and Local API reads/writes, including population', async () => {
        const pair = await f.pair('anonymous')
        const author = await f.request('POST', '/authors', { name: f.manifest.prefix + 'anonymous-author' })
        assert.equal(author.response.status, 201)
        ;(f.manifest.authors ??= []).push(author.body.doc.id)
        const loan = await f.request('POST', '/loans', { ...pair, issuedAt, dueAt })
        assert.equal(loan.response.status, 201)
        type DomainSlug = Extract<CollectionSlug, 'employees' | 'authors' | 'books' | 'members' | 'loans'>
        const ids: Record<DomainSlug, number> = { employees: admin.user.id, authors: author.body.doc.id, books: pair.book, members: pair.member, loans: loan.body.doc.id }
        for (const [slug, id] of Object.entries(ids) as [DomainSlug, number][]) {
          denied(await f.request('GET', `/${slug}?depth=5&populate[employees][role]=true`, undefined, false))
          denied(await f.request('GET', `/${slug}/${id}?depth=5`, undefined, false))
          denied(await f.request('POST', `/${slug}`, {}, false))
          denied(await f.request('PATCH', `/${slug}/${id}`, { name: 'attack' }, false))
          denied(await f.request('DELETE', `/${slug}/${id}`, undefined, false))
          await forbidden(() => payload.find({ collection: slug, depth: 5, overrideAccess: false }))
          await forbidden(() => payload.findByID({ collection: slug, id, depth: 5, overrideAccess: false }))
          await forbidden(() => payload.create({ collection: slug, data: { name: 'attack', role: 'admin', email: 'attack@example.com', password: randomUUID(), title: 'attack', inventoryNumber: 'attack', cardNumber: 'attack', book: pair.book, member: pair.member, issuedAt, dueAt }, overrideAccess: false }))
          await forbidden(() => payload.update({ collection: slug, id, data: { name: 'attack' }, overrideAccess: false }))
          await forbidden(() => payload.delete({ collection: slug, id, overrideAccess: false }))
        }
        denied(await f.request('POST', `/loans/${loan.body.doc.id}/return`, undefined, false))
        const req = await createLocalReq({}, payload)
        req.routeParams = { id: String(loan.body.doc.id) }
        await forbidden(() => Promise.resolve(returnLoan.handler(req)))
      })
    }
  }
} finally {
  try {
    if (fixtures && !retainForUI) {
      await fixtures.cleanup()
      console.log('PASS: all role fixtures removed; owner account, password and library records preserved.')
    }
  } finally { await payload.destroy() }
}
if (failures) throw new Error(`${failures} access integration checks failed.`)
