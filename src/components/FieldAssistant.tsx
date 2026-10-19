'use client'

import { Button, useAuth, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormContext } from '../ai/context'
import styles from './fieldAssistant.module.css'

async function readResponse(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message || ([401, 403].includes(response.status)
    ? 'Нет доступа. Войдите как сотрудник и проверьте права.'
    : 'Не удалось получить ответ помощника. Попробуйте позже.'))
  if (!body) throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.')
  return body
}

export function FieldAssistant() {
  const { user } = useAuth()
  const { config } = useConfig()
  const { collectionSlug } = useDocumentInfo()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<FormContext>()
  const [field, setField] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [asking, setAsking] = useState(false)
  const [revision, setRevision] = useState(0)
  const pending = useRef<AbortController | null>(null)
  const endpoint = `${config.routes.api}/field-help/${collectionSlug}`

  useEffect(() => {
    if (!open || !collectionSlug) return
    const controller = new AbortController()
    setLoading(true); setError(''); setAnswer(''); setContext(undefined)
    void fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => {
        const body = await readResponse(response)
        if (!body.context || !Array.isArray(body.context.fields)) throw new Error('Не удалось прочитать описания полей. Повторите загрузку.')
        if (!controller.signal.aborted) { setContext(body.context); setField(body.context.fields[0]?.name || '') }
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError', 'SyntaxError'].includes(error.name)
          ? error.message : 'Не удалось загрузить описания полей. Проверьте соединение и повторите загрузку.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); pending.current?.abort() }
  }, [open, collectionSlug, endpoint, revision])

  if (user?.collection !== 'employees' || !['admin', 'librarian'].includes(user.role)) return null

  async function ask() {
    if (asking || !field || !question.trim()) return
    const controller = new AbortController()
    pending.current = controller
    setAsking(true); setError(''); setAnswer('')
    try {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, question: question.trim() }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]),
      })
      const body = await readResponse(response)
      if (typeof body.answer !== 'string' || !body.answer.trim()) throw new Error('Сервер вернул пустой ответ. Попробуйте ещё раз.')
      if (!controller.signal.aborted) setAnswer(body.answer)
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError', 'SyntaxError'].includes(error.name) ? error.message : 'Не удалось получить ответ. Вопрос сохранён; попробуйте ещё раз.')
    } finally { if (pending.current === controller) { pending.current = null; setAsking(false) } }
  }

  const selected = context?.fields.find(value => value.name === field)
  return <details className={styles.block} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>AI-помощник по полям</summary>
    <p>Объясняет поля текущей формы. Ответ не изменяет записи и не сохраняет форму.</p>
    <p>В OpenRouter отправляются вопрос и описания полей, без значений текущей карточки. Не вводите персональные данные, пароли или секреты.</p>
    {loading ? <p role="status">Загружаем описания полей…</p> : context && <>
      <label htmlFor={`${id}-field`}>Поле</label>
      <select id={`${id}-field`} className={styles.control} value={field} disabled={asking} onChange={event => { setField(event.target.value); setAnswer(''); setError('') }}>
        {context.fields.map(field => <option key={field.name} value={field.name}>{field.label} ({field.name})</option>)}
      </select>
      {selected && <p className={styles.source}>Описание из формы: {selected.description}</p>}
      <label htmlFor={`${id}-question`}>Вопрос о поле</label>
      <textarea id={`${id}-question`} className={styles.control} rows={3} maxLength={1000} value={question} disabled={asking}
        placeholder="Что означает это поле и как его заполнить?" onChange={event => { setQuestion(event.target.value); setAnswer(''); setError('') }} />
      <Button type="button" size="small" buttonStyle="secondary" disabled={asking || !field || !question.trim()} onClick={ask}>
        {asking ? 'Получаем ответ…' : 'Спросить AI'}
      </Button>
      {asking && <p role="status">Помощник готовит ответ…</p>}
      {answer && <div role="status" className={styles.answer}><strong>Ответ AI</strong><p>{answer}</p><small>Источник: {context.label}.{field}. Проверяйте ответ по описаниям полей и сообщениям валидации.</small></div>}
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!loading && !context && <Button type="button" size="small" buttonStyle="secondary" onClick={() => setRevision(value => value + 1)}>Загрузить описания полей</Button>}
  </details>
}
