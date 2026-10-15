'use client'

import { Button, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { Loan } from '../payload-types'
import { displayDate, errorMessage, inlineRequest, localDateTime } from './inline/shared'
import styles from './inline/styles.module.css'

type LoanPage = { docs: Loan[]; page: number; totalPages: number; totalDocs: number }
const pageSize = 5

function LoanRow({ initialLoan, api, admin }: { initialLoan: Loan; api: string; admin: string }) {
  const [loan, setLoan] = useState(initialLoan)
  const [due, setDue] = useState(localDateTime(initialLoan.dueAt))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const dirty = due !== localDateTime(loan.dueAt)

  async function save() {
    if (saving || loan.returnedAt || !dirty) return
    setSaving(true); setError(''); setSuccess(false)
    try {
      if (!due || !Number.isFinite(Date.parse(due))) throw new Error('Укажите корректный срок возврата.')
      const { doc } = await inlineRequest<{ doc: Loan }>(`${api}/loans/${loan.id}?depth=1`, { dueAt: new Date(due).toISOString() })
      setLoan(doc); setDue(localDateTime(doc.dueAt)); setSuccess(true)
    } catch (error) { setError(errorMessage(error)) }
    finally { setSaving(false) }
  }

  return <tr data-inline-loan={loan.id}>
    <td>{typeof loan.book === 'object' ? <>{loan.book.title}<br /><small>{loan.book.inventoryNumber}</small></> : `Книга #${loan.book}`}
      <br /><a href={`${admin}/collections/loans/${loan.id}`}>Открыть выдачу #{loan.id}</a></td>
    <td>{displayDate(loan.issuedAt)}</td>
    <td>{loan.returnedAt ? displayDate(loan.dueAt) : <>
      <label>Срок возврата #{loan.id}<br />
        <input className={styles.input} type="datetime-local" step="0.001" aria-label={`Срок возврата ${loan.id}`} value={due} disabled={saving}
          onChange={event => { setDue(event.target.value); setSuccess(false) }}
          onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} />
      </label>
      <Button type="button" size="small" buttonStyle="secondary" disabled={saving || !dirty} onClick={save}>{saving ? 'Сохраняем…' : 'Сохранить срок'}</Button>
    </>}
      {saving && <span className={styles.status} role="status">Сохраняем срок…</span>}
      {success && <span className={styles.status} role="status">Срок возврата сохранён.</span>}
      {error && <span className={`${styles.status} ${styles.error}`} role="alert">{error}</span>}
    </td>
    <td>{displayDate(loan.returnedAt)}{loan.returnedAt && <small className={styles.status}>Закрыта. Только просмотр.</small>}</td>
  </tr>
}

export function InlineLoans() {
  const { config } = useConfig()
  const { id } = useDocumentInfo()
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<LoanPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => { setPage(1) }, [id])
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    setLoading(true); setError('')
    const query = new URLSearchParams({ 'where[member][equals]': String(id), limit: String(pageSize), page: String(page), sort: '-issuedAt,-id', depth: '1' })
    void inlineRequest<LoanPage>(`${config.routes.api}/loans?${query}`, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setResult(result) })
      .catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, page, config.routes.api, revision])

  return <section className={styles.block} aria-label="Выдачи читателя: редактирование на странице">
    <h3>Выдачи читателя</h3>
    <p>Меняется только срок активной выдачи. Сохранение каждой строки независимо от формы читателя. Даты и время показаны в часовом поясе браузера.</p>
    {!id ? <p>Сначала сохраните читателя, затем здесь появятся его выдачи.</p> : loading ? <p role="status">Загружаем выдачи…</p> : error ? <>
      <p className={styles.error} role="alert">{error}</p>
      <Button type="button" size="small" buttonStyle="secondary" onClick={() => setRevision(value => value + 1)}>Повторить загрузку выдач</Button>
    </> : result && <>
      <div className={styles.scroll}><table className={styles.table}>
        <thead><tr><th>Книга / выдача</th><th>Выдана</th><th>Срок возврата</th><th>Возвращена</th></tr></thead>
        <tbody>{result.docs.map(loan => <LoanRow key={`${id}-${page}-${revision}-${loan.id}`} initialLoan={loan} api={config.routes.api} admin={config.routes.admin} />)}</tbody>
      </table></div>
      {!result.docs.length && <p>Выдач пока нет.</p>}
      <div className={styles.controls}>
        <Button type="button" size="small" buttonStyle="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Предыдущие выдачи</Button>
        <span>Страница {result.page} из {Math.max(1, result.totalPages)} · Всего: {result.totalDocs}</span>
        <Button type="button" size="small" buttonStyle="secondary" disabled={page >= result.totalPages} onClick={() => setPage(value => value + 1)}>Следующие выдачи</Button>
      </div>
    </>}
  </section>
}
