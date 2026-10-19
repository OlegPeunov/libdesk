import assert from 'node:assert/strict'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { LoanFixtures } from './loanFixtures'
import type { HelpField } from '../src/ai/context'

const live = process.argv.slice(2).filter(value => value !== '--').includes('live')
if (live) assert(process.env.OPENROUTER_API_KEY?.trim(), 'Set OPENROUTER_API_KEY locally before a live check.')
const payload = await getPayload({ config })
const fixtures = new LoanFixtures(payload)
try {
  const librarian = await fixtures.setup()
  const admin = await fixtures.actor('admin', 'ai-admin')
  async function request(method: string, collection: string, data?: unknown, token?: string, origin = fixtures.baseURL) {
    const response = await fetch(`${fixtures.baseURL}/api/field-help/${collection}`, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Cookie: `payload-token=${token}` } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(40_000),
    })
    return { response, body: await response.json() }
  }
  for (const actor of [admin, librarian]) {
    for (const slug of ['authors', 'books', 'members', 'loans', 'media']) {
      const { response, body } = await request('GET', slug, undefined, actor.token)
      assert.equal(response.status, 200)
      assert.equal(body.context.collection, slug)
      assert(body.context.fields.length > 0)
      assert(body.context.fields.every((field: HelpField) => field.description && !['password', 'hash', 'salt', 'fieldAssistant'].includes(field.name)))
      assert.match(response.headers.get('cache-control')!, /no-store/)
    }
    for (const data of [{ field: 'title', question: '' }, { field: 'password', question: '?' }, { field: 'title', question: '?', model: 'injected/model' }, { field: 'title', question: 'x'.repeat(1001) }]) {
      assert.equal((await request('POST', 'books', data, actor.token)).response.status, 400)
    }
    assert.equal((await request('GET', 'employees', undefined, actor.token)).response.status, 404)
    assert([401, 403].includes((await request('POST', 'books', { field: 'title', question: '?' }, actor.token, 'https://untrusted.example')).response.status))
    console.log(`PASS: ${actor.user.role}: real cookie authentication, five form contexts, input validation, excluded auth form and CSRF.`)
  }
  for (const method of ['GET', 'POST']) {
    assert.equal((await request(method, 'books', method === 'POST' ? { field: 'title', question: '?' } : undefined)).response.status, 401)
  }
  console.log('PASS: anonymous requests denied; validation checks made no model calls.')
  if (live) {
    for (const [actor, slug, field, question] of [
      [admin, 'books', 'isbn', 'Как заполнить ISBN? Могут ли два физических экземпляра иметь одинаковый ISBN и одинаковый инвентарный номер?'],
      [librarian, 'loans', 'dueAt', 'Как заполнить срок возврата относительно даты выдачи? Можно ли исправить его у уже возвращённой книги?'],
    ] as const) {
      const { response, body } = await request('POST', slug, { field, question }, actor.token)
      assert.equal(response.status, 200, body?.error?.message || 'Live OpenRouter request failed.')
      assert.equal(body.field, field)
      assert(typeof body.answer === 'string' && body.answer.trim())
      console.log(`LIVE ${actor.user.role} / ${slug}.${field}: ${body.answer}`)
    }
    console.log('PASS: real OpenRouter answers through the authenticated app endpoint for both roles.')
  }
} finally {
  try { await fixtures.cleanup() } finally { await payload.destroy() }
}
