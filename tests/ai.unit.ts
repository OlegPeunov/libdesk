import assert from 'node:assert/strict'
import type { PayloadRequest } from 'payload'
import config from '../src/payload.config'
import { formContext } from '../src/ai/context'
import { explainField, HelpError } from '../src/ai/openrouter'
import { createHelpLimiter } from '../src/ai/limits'
import { helpAnswer, helpDefinition } from '../src/ai/endpoints'
import { passesRussianScriptCheck } from '../src/ai/answer'

const collection = (await config).collections.find(value => value.slug === 'books')!
const context = formContext(collection)
assert(context.fields.some(field => field.name === 'inventoryNumber' && field.required && field.unique))
assert(context.fields.some(field => field.name === 'isbn' && !field.required && !field.unique))
assert(context.fields.some(field => field.name === 'authors' && field.hasMany && field.relationTo === 'authors'))
assert(!context.fields.some(field => ['id', 'fieldAssistant', 'inlineAuthors', 'createdAt', 'updatedAt', 'password', 'hash'].includes(field.name)))
const changed = formContext({ ...collection, fields: collection.fields.map(field => field.type === 'text' && field.name === 'title' ? { ...field, admin: { ...field.admin, description: 'Changed real help text' } } : field) })
assert.equal(changed.fields.find(field => field.name === 'title')?.description, 'Changed real help text')
console.log('PASS: actual schema descriptions, required/unique/relationship metadata; no records or auth fields.')

const invalidProse = [
  'Поле photo是用来上传图书照片的，例如封面或书脊图片。支持 JPEG、PNG、WEBP 格式。',
  'Поле photo is used to upload a photograph of a book. The image must follow the allowed size and format constraints. Например, use a cover.',
  'User Safety: safe',
  'Поле фотографии нужно заполнить правильно. User Safety: safe',
  `${'Это фотография книги, которую можно загрузить в карточку. '.repeat(12)}\n\nThis paragraph contains an English explanation of the required photograph.`,
  `${'Это фотография книги. '.repeat(12)} The file should contain a photograph of the book cover.`,
  '<think>Это внутренние рассуждения.</think> Можно загрузить фотографию книги.',
  '安全性 safe',
  '',
]
for (const text of invalidProse) assert.equal(passesRussianScriptCheck(text, context), false)
for (const text of [
  'Загрузите JPEG, PNG или WebP до 3 МиБ: максимум 4096 пикселей по стороне и 16 мегапикселей. Например, обложку книги в JPEG размером 2 MiB.',
  'Можно загрузить JPEG/PNG/WebP размером до 3MiB, со стороной до 4096px и площадью до 16MP. Например, обложку книги.',
  'Поле photo необязательно. ISBN может совпадать у копий, но inventoryNumber должен быть уникальным. Например, INV-001 и INV-002.',
  'Пример контакта: reader@example.com. Это адрес читателя, а не логин сотрудника.',
  'Я объясняю поля форм LibDesk. Выберите поле и задайте вопрос о нём.',
]) assert.equal(passesRussianScriptCheck(text, context), true)
const loanContext = formContext((await config).collections.find(value => value.slug === 'loans')!)
assert(passesRussianScriptCheck('Поле dueAt должно быть позже issuedAt. Если returnedAt заполнено, выдача закрыта и больше не редактируется. Например, выдача 01.10.2026 10:00 и срок 15.10.2026 10:00.', loanContext))
console.log('PASS: mixed Chinese/English, foreign paragraphs and service labels rejected; Russian technical examples accepted (script heuristic only).')

const key = 'test-key-not-a-real-credential'
let calls = 0
const transport: typeof fetch = async (url, init) => {
  calls++
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`)
  const body = JSON.parse(String(init?.body))
  assert.equal(body.model, 'openrouter/free')
  assert(body.messages[0].content.includes(JSON.stringify(context)))
  assert(body.messages[0].content.includes('Единственный источник'))
  assert.equal(body.messages[1].role, 'user')
  assert.deepEqual(JSON.parse(body.messages[1].content), { field: 'inventoryNumber', question: 'Что вводить?' })
  assert(!JSON.stringify(body).includes(key))
  assert.equal(body.stream, false)
  assert.equal(body.max_tokens, 800)
  assert.deepEqual(body.reasoning, { enabled: false })
  assert.deepEqual(body.provider, { max_price: { prompt: 0, completion: 0, request: 0 }, allow_fallbacks: false })
  assert(init?.signal instanceof AbortSignal)
  return Response.json({ choices: [{ message: { content: 'Уникальный номер физического экземпляра.' }, finish_reason: 'stop' }] })
}
assert.equal(await explainField(context, 'inventoryNumber', 'Что вводить?', { apiKey: key, model: 'openrouter/free', fetch: transport }), 'Уникальный номер физического экземпляра.')
assert.equal(calls, 1)
for (const answer of invalidProse) {
  await assert.rejects(explainField(context, 'photo', '?', { apiKey: key, fetch: async () => Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }) }), (error: unknown) => error instanceof HelpError && error.code === 'invalid_answer')
}
await assert.rejects(explainField(context, 'title', '?', { apiKey: '', fetch: transport }), (error: unknown) => error instanceof HelpError && error.code === 'not_configured')
assert.equal(calls, 1, 'Missing configuration must never call a provider.')
await assert.rejects(explainField(context, 'title', '?', { apiKey: key, model: 'paid/model', fetch: transport }), (error: unknown) => error instanceof HelpError && error.code === 'invalid_model')
assert.equal(calls, 1, 'Paid model configuration must never call a provider.')
assert.equal(await explainField(context, 'title', '?', { apiKey: key, model: 'example/model:free', fetch: async () => Response.json({ choices: [{ message: { content: 'Бесплатная модель.' }, finish_reason: 'stop' }] }) }), 'Бесплатная модель.')
for (const [status, code] of [[401, 'provider_auth'], [402, 'provider_budget'], [429, 'provider_rate_limit'], [504, 'provider_timeout'], [500, 'provider_unavailable']] as const) {
  await assert.rejects(explainField(context, 'title', '?', { apiKey: key, fetch: async () => new Response('PRIVATE PROVIDER DIAGNOSTICS', { status }) }), (error: unknown) => error instanceof HelpError && error.code === code && !error.message.includes('PRIVATE'))
}
for (const result of [
  { error: { code: 429, message: 'PRIVATE', metadata: { error_type: 'rate_limit_exceeded' } } },
  { choices: [{ finish_reason: 'error', error: { code: 503 }, message: { content: 'partial' } }] },
  { choices: [{ finish_reason: 'stop', message: { content: '' } }] },
  { choices: [{ finish_reason: 'stop', message: { content: 'User Safety: safe' } }] },
  { choices: [{ finish_reason: 'length', message: { content: 'incomplete answer' } }] },
  { choices: [{ finish_reason: 'content_filter', message: { refusal: 'PRIVATE' } }] },
  { choices: [{ finish_reason: 'stop', message: { content: 'x'.repeat(6001) } }] },
]) await assert.rejects(explainField(context, 'title', '?', { apiKey: key, fetch: async () => Response.json(result) }), (error: unknown) => error instanceof HelpError && !error.message.includes('PRIVATE'))
for (const error of [new DOMException('private timeout', 'TimeoutError'), new TypeError('private network error')]) {
  await assert.rejects(explainField(context, 'title', '?', { apiKey: key, fetch: async () => { throw error } }), (error: unknown) => error instanceof HelpError && !error.message.includes('private'))
}
console.log('PASS: grounded provider request, missing key, auth/budget/rate/timeout/network failures, HTTP-200 errors, empty/truncated/refused answers; no diagnostics leaked.')

const acquire = createHelpLimiter()
const release = acquire('one', 0)
assert.throws(() => acquire('one', 1), HelpError)
acquire('two', 1)()
release()
for (let index = 0; index < 4; index++) acquire('one', 2 + index)()
assert.throws(() => acquire('one', 100), HelpError)
acquire('one', 60_001)()
console.log('PASS: per-employee concurrency/rate limits, separate employees and window expiry.')

let nextUserID = 100_000
function request({ role = 'librarian', slug = 'books', origin = 'http://localhost:3000', data = { field: 'inventoryNumber', question: 'Что вводить?' }, method = 'POST', read = true }: {
  role?: string; slug?: string; origin?: string; data?: unknown; method?: string; read?: boolean
} = {}): PayloadRequest {
  return Object.assign(new Request(`http://localhost:3000/api/field-help/${slug}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(data) } : {}),
  }), {
    user: role === 'anonymous' ? null : { id: nextUserID++, collection: 'employees', role },
    routeParams: { collection: slug },
    payload: { config: { serverURL: 'http://localhost:3000' }, collections: { books: { config: { ...collection, access: { ...collection.access, read: () => read } } } } },
  }) as unknown as PayloadRequest
}
const originalFetch = globalThis.fetch
const originalKey = process.env.OPENROUTER_API_KEY
const originalModel = process.env.OPENROUTER_MODEL
try {
  process.env.OPENROUTER_API_KEY = key
  delete process.env.OPENROUTER_MODEL
  assert.equal(await explainField(context, 'inventoryNumber', 'Что вводить?', { fetch: transport }), 'Уникальный номер физического экземпляра.')
  process.env.OPENROUTER_MODEL = 'google/gemma-4-31b-it:free'
  await explainField(context, 'title', '?', { fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, process.env.OPENROUTER_MODEL)
    assert.equal(body.models, undefined, 'No fallback model list.')
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Укажите название книги, например «Морская библиотека».' } }] })
  } })
  process.env.OPENROUTER_MODEL = 'openrouter/free'
  globalThis.fetch = transport
  for (const role of ['admin', 'librarian']) {
    const definition = await helpDefinition.handler(request({ role, method: 'GET' }))
    assert.equal(definition.status, 200)
    assert.deepEqual((await definition.json()).context, context)
    assert.equal((await helpAnswer.handler(request({ role }))).status, 200)
  }
  const before = calls
  for (const method of ['GET', 'POST']) assert.equal((await (method === 'GET' ? helpDefinition : helpAnswer).handler(request({ method, role: 'anonymous' }))).status, 401)
  assert.equal((await helpAnswer.handler(request({ role: 'invalid-role' }))).status, 401)
  assert.equal((await helpAnswer.handler(request({ read: false }))).status, 403)
  assert.equal((await helpAnswer.handler(request({ origin: 'https://untrusted.example' }))).status, 403)
  assert.equal((await helpAnswer.handler(request({ slug: 'employees' }))).status, 404)
  for (const data of [null, [], {}, { field: 'hash', question: '?' }, { field: 'title', question: '' }, { field: 'title', question: 'x'.repeat(1001) }, { field: 'title', question: '?', model: 'attacker/model' }, { field: 'title', question: '?', context: { secret: 'injected' } }, { field: 'title', question: '\u0000' }]) {
    assert.equal((await helpAnswer.handler(request({ data }))).status, 400)
  }
  assert.equal((await helpAnswer.handler(request({ data: { field: 'title', question: 'x'.repeat(5000) } }))).status, 413)
  assert.equal(calls, before, 'Invalid/anonymous/forbidden requests must never reach OpenRouter.')
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'User Safety: safe' } }] })
  const malformed = await helpAnswer.handler(request())
  assert.equal(malformed.status, 502)
  const malformedBody = await malformed.json()
  assert.equal(malformedBody.error.code, 'invalid_answer')
  assert(!malformedBody.error.message.includes('User Safety'))
  console.log('PASS: both roles, anonymous/foreign-origin/access denial, input/body limits and refusal of injected context/model/auth fields.')
} finally {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey
  if (originalModel === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = originalModel
}
