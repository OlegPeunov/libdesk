import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { getPayload } from 'payload'
import sharp from 'sharp'
import { LoanFixtures, type FixtureManifest, type TestActor } from './loanFixtures'
import { MAX_FILE_BYTES, MEDIA_PREFIX } from '../src/media/image'

const mode = process.argv[2]
// An isolated CLI process simulates an unavailable provider. No app flags,
// request context bypasses, real credential edits or local-storage fallback.
if (mode === 'unavailable') {
  process.env.R2_ENDPOINT = 'https://127.0.0.1:1'
  process.env.R2_ACCESS_KEY_ID = 'unavailable-test-key'
  process.env.R2_SECRET_ACCESS_KEY = 'unavailable-test-secret'
}
const { default: config } = await import('../src/payload.config')
const { mediaKeys, r2Settings } = await import('../src/media/storage')
const payload = await getPayload({ config })
const settings = r2Settings()
const s3 = new S3Client(settings.config)
const uiPath = path.join(tmpdir(), 'libdesk-media-ui-fixtures.json')
type StoredUI = { manifest: FixtureManifest; admin: TestActor; media: number[]; book: number; filePath: string }
let f: LoanFixtures | undefined
let admin: TestActor | undefined
let media: number[] = []
let retained = false
let failures = 0
const image = (format: 'png' | 'jpeg' | 'webp' = 'png', width = 640, height = 480) => sharp({ create: { width, height, channels: 3, background: '#546ad3' } }).toFormat(format).toBuffer()
const user = async (actor: TestActor) => {
  let result = await payload.auth({ headers: new Headers({ Authorization: `JWT ${actor.token}` }) })
  if (!result.user) {
    // A long pause or transient database failure must not prevent fixture cleanup.
    const login = await payload.login({ collection: 'employees', data: { email: actor.user.email, password: actor.password } })
    assert(login.token)
    actor.token = login.token
    if (f?.manifest.employee?.id === actor.user.id) f.token = actor.token
    result = await payload.auth({ headers: new Headers({ Authorization: `JWT ${actor.token}` }) })
  }
  assert(result.user)
  return result.user
}
const rejected = (status: number) => assert([400, 401, 403, 409, 413].includes(status), `Expected rejection; got ${status}.`)
const check = async (name: string, run: () => Promise<void>) => {
  try { await run(); console.log('PASS: ' + name) }
  catch (error) { failures++; console.error('FAIL: ' + name + ': ' + (error instanceof Error ? error.message : 'Unknown error')) }
}
async function objects() {
  const result = await s3.send(new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: `${MEDIA_PREFIX}/${f!.manifest.prefix}` }))
  assert(!result.IsTruncated, 'Test prefix should contain fewer than 1000 objects.')
  return (result.Contents ?? []).map(object => object.Key!).sort()
}
async function upload(buffer: Buffer, suffix: string, mime = 'image/png', actor?: TestActor, extra = {}) {
  const form = new FormData()
  form.set('_payload', JSON.stringify({ alt: f!.manifest.prefix + suffix, ...extra }))
  form.set('file', new Blob([new Uint8Array(buffer)], { type: mime }), f!.manifest.prefix + suffix)
  const response = await fetch(`${f!.baseURL}/api/media`, { method: 'POST', headers: actor ? { Authorization: `JWT ${actor.token}` } : {}, body: form, signal: AbortSignal.timeout(60_000) })
  const body = await response.json()
  if (body.doc?.id) media.push(body.doc.id)
  return { response, body }
}
async function assertObjects(doc: Parameters<typeof mediaKeys>[0]) {
  const keys = mediaKeys(doc)
  assert(keys.length >= 2, 'Original and thumbnail must both exist.')
  for (const Key of keys) {
    assert(Key.startsWith(`${MEDIA_PREFIX}/${f!.manifest.prefix}`), 'Only own test objects may be inspected.')
    const head = await s3.send(new HeadObjectCommand({ Bucket: settings.bucket, Key }))
    assert(head.ContentLength && head.ContentLength > 0)
  }
  return keys
}
async function cleanup() {
  if (!f || !admin) return
  // Unlink only fixture books. Normal Media access/hooks and R2 deletion remain enabled.
  for (const id of f.manifest.books) {
    const row = await payload.findByID({ collection: 'books', id, depth: 0, user: await user(admin), overrideAccess: false })
    assert(row.inventoryNumber.startsWith(f.manifest.prefix))
    await payload.update({ collection: 'books', id, data: { photo: null }, user: await user(admin), overrideAccess: false })
  }
  for (const id of media) {
    const doc = await payload.findByID({ collection: 'media', id, depth: 0, user: await user(admin), overrideAccess: false })
    assert(doc.alt.startsWith(f.manifest.prefix))
    assert(doc.filename?.startsWith(f.manifest.prefix), 'Cleanup must only delete fixture-owned storage identities.')
    const keys = mediaKeys(doc)
    await f.db.pool.query('DELETE FROM payload_locked_documents WHERE id IN (SELECT parent_id FROM payload_locked_documents_rels WHERE media_id = $1)', [id])
    await payload.delete({ collection: 'media', id, user: await user(admin), overrideAccess: false })
    for (const Key of keys) await assert.rejects(s3.send(new HeadObjectCommand({ Bucket: settings.bucket, Key })), (error: unknown) => typeof error === 'object' && error !== null && '$metadata' in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404)
  }
  if (mode === 'recover') {
    for (const Key of await objects()) {
      assert(Key.startsWith(`${MEDIA_PREFIX}/${f.manifest.prefix}`))
      await s3.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key }))
    }
  }
  if (mode !== 'unavailable') assert.deepEqual(await objects(), [], 'No objects should remain under the test prefix.')
  await f.cleanup()
  console.log('PASS: temporary Media, R2 objects and staff removed; existing data preserved.')
}

try {
  if (mode === 'recover') {
    const prefix = process.argv[3]
    assert.match(prefix, /^LIBDESK-TEST-[0-9a-f-]{36}-$/)
    const ids = async (table: string, column: string) => (await payload.db.pool.query(`SELECT id FROM ${table} WHERE left(${column}, length($1)) = $1 ORDER BY id`, [prefix])).rows.map(row => Number(row.id))
    const employees = (await payload.db.pool.query('SELECT id,email FROM employees WHERE left(name,length($1))=$1', [prefix])).rows
    const manifest: FixtureManifest = { prefix, employees, books: await ids('books', 'inventory_number'), members: await ids('members', 'card_number'), authors: await ids('authors', 'name') }
    f = new LoanFixtures(payload, manifest)
    admin = await f.actor('admin', 'recovery-' + randomUUID())
    media = await ids('media', 'filename')
    await cleanup(); f = undefined
  } else if (mode === 'cleanup-ui' || mode === 'verify-ui') {
    const saved = JSON.parse(await readFile(uiPath, 'utf8')) as StoredUI
    f = new LoanFixtures(payload, saved.manifest); admin = saved.admin; media = saved.media
    retained = true // Keep a failed UI verification available for explicit cleanup.
    if (mode === 'verify-ui') {
      const book = await payload.findByID({ collection: 'books', id: saved.book, depth: 1, user: await user(admin), overrideAccess: false })
      assert(book.photo && typeof book.photo === 'object')
      assert(book.photo.alt.startsWith(f.manifest.prefix))
      if (!media.includes(book.photo.id)) media.push(book.photo.id)
      saved.media = media
      await writeFile(uiPath, JSON.stringify(saved), { mode: 0o600 })
      await assertObjects(book.photo)
      for (const url of [book.photo.url, book.photo.sizes?.thumbnail?.url]) {
        assert(url)
        const target: URL = new URL(url, f.baseURL)
        assert.equal(target.origin, new URL(f.baseURL).origin)
        const response: Response = await fetch(target, { headers: { Authorization: `JWT ${admin.token}` } })
        assert.equal(response.status, 200)
        assert.match(response.headers.get('cache-control')!, /private.*no-store/)
        assert((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width)
        const anon = await fetch(target)
        rejected(anon.status)
        assert.match(anon.headers.get('cache-control')!, /no-store/)
      }
      retained = true
      console.log('PASS: saved book photo, R2 original/thumbnail and protected private URLs verified.')
    } else {
      const owned = await payload.find({ collection: 'media', where: { alt: { like: f.manifest.prefix } }, limit: 1000, depth: 0, user: await user(admin), overrideAccess: false })
      media = [...new Set([...media, ...owned.docs.map(doc => doc.id)])]
      await cleanup(); f = undefined
      await unlink(saved.filePath); await unlink(uiPath)
      console.log('PASS: private UI credentials and upload fixture file removed.')
    }
  } else {
    assert(!mode || mode === 'prepare-ui' || mode === 'unavailable')
    f = new LoanFixtures(payload)
    console.log('Media test prefix: ' + f.manifest.prefix)
    const librarian = await f.setup()
    admin = await f.actor('admin', 'media-admin')
    const png = await image()
    if (mode === 'prepare-ui') {
      await assert.rejects(readFile(uiPath), { code: 'ENOENT' })
      const pair = await f.pair('photo-UI', admin.token)
      const filePath = path.join(tmpdir(), f.manifest.prefix + 'cover.png')
      await writeFile(filePath, png, { mode: 0o600, flag: 'wx' })
      await writeFile(uiPath, JSON.stringify({ manifest: f.manifest, admin, media, book: pair.book, filePath } satisfies StoredUI), { mode: 0o600, flag: 'wx' })
      retained = true
      console.log('Temporary book, private staff credentials and PNG prepared for UI verification; values not printed.')
    } else if (mode === 'unavailable') {
      await check('unavailable R2: clear 503, transaction rollback, no success row or local fallback', async () => {
        await assert.rejects(payload.create({ collection: 'media', data: { alt: f!.manifest.prefix + 'unavailable' }, file: { data: png, size: png.length, name: f!.manifest.prefix + 'unavailable.png', mimetype: 'image/png' }, user: await user(admin!), overrideAccess: false }), (error: unknown) => typeof error === 'object' && error !== null && 'status' in error && error.status === 503)
        const rows = await payload.find({ collection: 'media', where: { alt: { like: f!.manifest.prefix } }, user: await user(admin!), overrideAccess: false })
        assert.equal(rows.totalDocs, 0)
      })
    } else {
      await check('JPEG, PNG, WebP: role uploads, real original and thumbnail objects', async () => {
        for (const [format, actor] of [['jpeg', admin], ['png', librarian], ['webp', librarian]] as const) {
          const result = await upload(await image(format), `valid.${format === 'jpeg' ? 'jpg' : format}`, `image/${format}`, actor)
          assert.equal(result.response.status, 201, 'Valid image upload should succeed.')
          await assertObjects(result.body.doc)
        }
      })
      await check('same incoming filename gets unique object keys without overwriting', async () => {
        const a = await upload(png, 'same.png', 'image/png', admin)
        const b = await upload(png, 'same.png', 'image/png', librarian)
        assert.equal(a.response.status, 201); assert.equal(b.response.status, 201)
        assert.notEqual(a.body.doc.filename, b.body.doc.filename)
        await assertObjects(a.body.doc); await assertObjects(b.body.doc)
      })
      await check('SVG, GIF, spoofed MIME/extension, corrupt data, byte and pixel limits rejected before R2', async () => {
        const before = await objects()
        const cases: [Buffer, string, string][] = [
          [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'svg.svg', 'image/svg+xml'],
          [Buffer.from('GIF89a'), 'gif.gif', 'image/gif'],
          [png, 'spoof.jpg', 'image/jpeg'], [png, 'spoof.png', 'image/jpeg'], [png, 'spoof.svg', 'image/png'],
          [png.subarray(0, 40), 'corrupt.png', 'image/png'], [Buffer.from([255,216,255,0,1,2]), 'corrupt.jpg', 'image/jpeg'],
          [Buffer.alloc(MAX_FILE_BYTES + 1, 1), 'large.png', 'image/png'],
          [await image('png', 4097, 1), 'wide.png', 'image/png'], [await image('png', 4096, 4096), 'pixels.png', 'image/png'],
        ]
        for (const [buffer, filename, mime] of cases) rejected((await upload(buffer, filename, mime, admin)).response.status)
        assert.deepEqual(await objects(), before)
        await assert.rejects(payload.create({ collection: 'media', data: { alt: f!.manifest.prefix + 'large-local' }, file: { data: Buffer.alloc(MAX_FILE_BYTES + 1), size: MAX_FILE_BYTES + 1, name: f!.manifest.prefix + 'large-local.png', mimetype: 'image/png' }, user: await user(librarian), overrideAccess: false }))
      })
      await check('Media REST/Local rights, immutable storage identity and anonymous upload/read/download denied', async () => {
        const id = media[0]
        for (const actor of [admin!, librarian]) {
          const doc = await payload.findByID({ collection: 'media', id, user: await user(actor), overrideAccess: false })
          assert.equal(doc.id, id)
          const updated = await f!.request('PATCH', `/media/${id}`, { alt: f!.manifest.prefix + 'edited', prefix: 'outside', filename: 'someone-else.jpg', url: 'https://example.com/other.jpg' }, actor.token)
          assert.equal(updated.response.status, 200)
          assert.equal(updated.body.doc.filename, doc.filename)
          assert.equal(updated.body.doc.prefix, doc.prefix)
          await payload.update({ collection: 'media', id, data: { alt: f!.manifest.prefix + 'local-edit' }, user: await user(actor), overrideAccess: false })
        }
        rejected((await f!.request('DELETE', `/media/${id}`, undefined, librarian.token)).response.status)
        await assert.rejects(payload.delete({ collection: 'media', id, user: await user(librarian), overrideAccess: false }))
        rejected((await upload(png, 'anonymous.png')).response.status)
        for (const route of ['/media', `/media/${id}`]) rejected((await f!.request('GET', route, undefined, false)).response.status)
        rejected((await f!.request('PATCH', `/media/${id}`, { alt: 'anonymous' }, false)).response.status)
        rejected((await f!.request('DELETE', `/media/${id}`, undefined, false)).response.status)
        await assert.rejects(payload.find({ collection: 'media', overrideAccess: false }))
        await assert.rejects(payload.update({ collection: 'media', id, data: { alt: 'anonymous' }, overrideAccess: false }))
        await assert.rejects(payload.delete({ collection: 'media', id, overrideAccess: false }))
        await assert.rejects(payload.create({ collection: 'media', data: { alt: 'anonymous' }, file: { data: png, size: png.length, name: 'anon.png', mimetype: 'image/png' }, overrideAccess: false }))
      })
      await check('protected original/thumbnail URLs: authenticated bytes, range, ETag, private cache, anonymous denial and private bucket', async () => {
        const doc = await payload.findByID({ collection: 'media', id: media[0], user: await user(admin!), overrideAccess: false })
        for (const url of [doc.url, doc.sizes?.thumbnail?.url]) {
          assert(url && !url.includes('X-Amz-'))
          const target = new URL(url, f!.baseURL); assert.equal(target.origin, new URL(f!.baseURL).origin)
          const response = await fetch(target, { headers: { Authorization: `JWT ${librarian.token}` } })
          assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /private.*no-store/)
          const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length > 0)
          const decoded = await sharp(bytes).metadata(); assert(decoded.width)
          const anon = await fetch(target); rejected(anon.status)
          assert.match(anon.headers.get('cache-control')!, /no-store/)
          const conditional = await fetch(target, { headers: { Authorization: `JWT ${admin!.token}`, 'If-None-Match': response.headers.get('etag')! } })
          assert.equal(conditional.status, 304); assert.match(conditional.headers.get('cache-control')!, /private.*no-store/)
          const range = await fetch(target, { headers: { Authorization: `JWT ${admin!.token}`, Range: 'bytes=0-15' } })
          assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 16)
        }
        const key = mediaKeys(doc)[0]
        const object = await s3.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }))
        assert((await object.Body!.transformToByteArray()).length > 0)
        const direct = new URL(`${settings.bucket}/${key}`, settings.config.endpoint + '/')
        const publicRead = await fetch(direct)
        assert([400,401,403].includes(publicRead.status), 'Unsigned direct bucket access must be denied.')
      })
      await check('shared book photo, depth population, used-image deletion denied; unlink/book delete keep R2 objects', async () => {
        const id = media[0]
        const one = await f!.pair('photo-one', admin!.token); const two = await f!.pair('photo-two', librarian.token)
        for (const [book, actor] of [[one.book, admin!], [two.book, librarian]] as const) {
          assert.equal((await f!.request('PATCH', `/books/${book}`, { photo: id }, actor.token)).response.status, 200)
          const populated = await f!.request('GET', `/books/${book}?depth=2&populate[media][alt]=true`, undefined, actor.token)
          assert.equal(populated.body.photo.id, id)
        }
        rejected((await f!.request('DELETE', `/media/${id}`, undefined, admin!.token)).response.status)
        await assert.rejects(payload.delete({ collection: 'media', id, user: await user(admin!), overrideAccess: false }))
        assert.equal((await f!.request('PATCH', `/books/${one.book}`, { photo: null }, admin!.token)).response.status, 200)
        rejected((await f!.request('DELETE', `/media/${id}`, undefined, admin!.token)).response.status)
        assert.equal((await f!.request('DELETE', `/books/${two.book}`, undefined, admin!.token)).response.status, 200)
        f!.manifest.books = f!.manifest.books.filter(book => book !== two.book)
        await assertObjects(await payload.findByID({ collection: 'media', id, user: await user(admin!), overrideAccess: false }))
        const result = await f!.request('DELETE', `/media/${id}`, undefined, admin!.token)
        assert.equal(result.response.status, 200)
        media = media.filter(value => value !== id)
      })
      await check('Local API upload uses identical validation, access and R2 storage', async () => {
        await assert.rejects(payload.create({ collection: 'media', data: { alt: f!.manifest.prefix + 'no-transaction' }, file: { data: png, size: png.length, name: f!.manifest.prefix + 'no-transaction.png', mimetype: 'image/png' }, user: await user(librarian), overrideAccess: false, disableTransaction: true }), (error: unknown) => typeof error === 'object' && error !== null && 'status' in error && error.status === 500)
        const doc = await payload.create({ collection: 'media', data: { alt: f!.manifest.prefix + 'local-upload' }, file: { data: png, size: png.length, name: f!.manifest.prefix + 'local.png', mimetype: 'image/png' }, user: await user(librarian), overrideAccess: false, context: { skipCloudStorage: true, _payloadCloudStorage: { file: { data: Buffer.from('fake') } } } })
        media.push(doc.id); await assertObjects(doc)
      })
    }
  }
} finally {
  try { if (!retained) await cleanup() }
  finally { s3.destroy(); await payload.destroy() }
}
if (failures) throw new Error(`${failures} media integration checks failed.`)
