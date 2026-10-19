import type { Endpoint, PayloadRequest } from 'payload'
import { isEmployee } from '../access/roles'
import { formContext, helpCollections } from './context'
import { explainField, HelpError } from './openrouter'
import { createHelpLimiter } from './limits'

const acquire = createHelpLimiter()
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization, Origin' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': '60' } : {}) } })

async function contextFor(req: PayloadRequest) {
  if (!isEmployee({ req })) throw new HelpError('unauthenticated', 'Войдите как сотрудник, чтобы пользоваться помощником.', 401)
  const slug = req.routeParams?.collection
  if (typeof slug !== 'string' || !helpCollections.some(value => value === slug)) throw new HelpError('unknown_form', 'Помощник не поддерживает эту форму.', 404)
  const collection = req.payload.collections[slug as typeof helpCollections[number]].config
  if (await collection.access.read({ req, collectionConfig: collection }) === false) throw new HelpError('forbidden', 'Нет доступа к этой форме.', 403)
  return formContext(collection)
}

async function inputFor(req: PayloadRequest): Promise<{ field: string; question: string }> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HelpError('invalid_input', 'Отправьте вопрос в формате JSON.', 400)
  const reader = req.body?.getReader()
  if (!reader) throw new HelpError('invalid_input', 'Укажите поле и вопрос.', 400)
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 4096) { await reader.cancel(); throw new HelpError('too_large', 'Запрос слишком большой. Сократите вопрос.', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let data: unknown
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HelpError('invalid_input', 'Не удалось прочитать вопрос.', 400) }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['field', 'question'].includes(key))) throw new HelpError('invalid_input', 'Допустимы только поле и вопрос.', 400)
  const { field, question } = data as Record<string, unknown>
  if (typeof field !== 'string' || field.length > 100 || typeof question !== 'string' || !question.trim() || question.trim().length > 1000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(question)) {
    throw new HelpError('invalid_input', 'Выберите поле и задайте вопрос длиной от 1 до 1000 символов.', 400)
  }
  return { field, question: question.trim() }
}

function failure(error: unknown) {
  if (error instanceof HelpError) return json({ error: { code: error.code, message: error.message } }, error.status)
  return json({ error: { code: 'unavailable', message: 'Не удалось получить ответ помощника. Вопрос сохранён; попробуйте позже.' } }, 503)
}

export const helpDefinition: Endpoint = {
  path: '/field-help/:collection', method: 'get',
  handler: async req => {
    try { return json({ context: await contextFor(req) }) } catch (error) { return failure(error) }
  },
}

export const helpAnswer: Endpoint = {
  path: '/field-help/:collection', method: 'post',
  handler: async req => {
    let release: (() => void) | undefined
    try {
      const context = await contextFor(req)
      // Same-origin cookie requests retain Payload auth/CSRF; also reject foreign origins explicitly.
      if (req.headers.get('origin') !== req.payload.config.serverURL) throw new HelpError('forbidden_origin', 'Запрос должен быть отправлен из админки LibDesk.', 403)
      const { field, question } = await inputFor(req)
      if (!context.fields.some(value => value.name === field)) throw new HelpError('unknown_field', 'Выберите поле с описанием из текущей формы.', 400)
      release = acquire(String(req.user!.id))
      return json({ answer: await explainField(context, field, question), field })
    } catch (error) { return failure(error) }
    finally { release?.() }
  },
}
