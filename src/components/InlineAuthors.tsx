'use client'

import { Button, useConfig, useDocumentEvents, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { Author, Book } from '../payload-types'
import { errorMessage, inlineRequest, relationIDs } from './inline/shared'
import styles from './inline/styles.module.css'

function AuthorRow({ author, api }: { author: Author; api: string }) {
  const { reportUpdate } = useDocumentEvents()
  const [saved, setSaved] = useState(author)
  const [name, setName] = useState(author.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function save() {
    if (saving || name === saved.name) return
    setSaving(true); setError(''); setSuccess(false)
    try {
      // Only the author's name. Never submit or reset the surrounding book form.
      const { doc } = await inlineRequest<{ doc: Author }>(`${api}/authors/${author.id}`, { name })
      setSaved(doc); setName(doc.name); setSuccess(true)
      // Refresh the standard relationship selector's label without changing its selection.
      reportUpdate({ entitySlug: 'authors', id: doc.id, doc, operation: 'update', updatedAt: doc.updatedAt })
    } catch (error) { setError(errorMessage(error)) }
    finally { setSaving(false) }
  }

  return <div className={styles.row} data-inline-author={author.id}>
    <div className={styles.controls}>
      <label>Имя автора #{author.id}{' '}
        <input className={styles.input} aria-label={`Имя автора ${author.id}`} value={name} disabled={saving}
          onChange={event => { setName(event.target.value); setSuccess(false) }}
          onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} />
      </label>
      <Button type="button" size="small" buttonStyle="secondary" disabled={saving || name === saved.name} onClick={save}>
        {saving ? 'Сохраняем…' : 'Сохранить автора'}
      </Button>
    </div>
    {saving && <span className={styles.status} role="status">Сохраняем автора…</span>}
    {success && <span className={styles.status} role="status">Автор сохранён. Имя обновлено для всех связанных книг.</span>}
    {error && <span className={`${styles.status} ${styles.error}`} role="alert">{error}</span>}
  </div>
}

export function InlineAuthors() {
  const { config } = useConfig()
  const { id, data } = useDocumentInfo()
  const selected = useFormFields(([fields]) => fields.authors?.value)
  const [authors, setAuthors] = useState<Author[]>([])
  const [savedIDs, setSavedIDs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    setLoading(true); setError('')
    void inlineRequest<Book>(`${config.routes.api}/books/${id}?depth=1&select[authors]=true`, undefined, controller.signal)
      .then(book => {
        if (controller.signal.aborted) return
        const related = book.authors ?? []
        setSavedIDs(relationIDs(related))
        if (related.some(author => !author || typeof author !== 'object')) throw new Error('Нет доступа к некоторым авторам. Проверьте права и обновите блок.')
        setAuthors(related as Author[])
      })
      .catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, data?.updatedAt, config.routes.api, revision])

  return <section className={styles.block} aria-label="Авторы: редактирование на странице">
    <h3>Авторы: редактирование на странице</h3>
    <p>Сохраняется общая запись Authors. Новое имя отобразится у всех связанных книг. Это отдельное сохранение, независимо от формы книги.</p>
    {!id ? <p>Сначала сохраните книгу, затем редактируйте её авторов здесь.</p> : <>
      <p>Здесь показаны только сохранённые связи книги.</p>
      {JSON.stringify(relationIDs(selected)) !== JSON.stringify(savedIDs) && !loading && !error && <p className={styles.notice}>Выбор авторов в форме отличается. Сначала сохраните книгу, чтобы обновить связи в этом блоке.</p>}
      {loading ? <p role="status">Загружаем авторов…</p> : error ? <>
        <p className={styles.error} role="alert">{error}</p>
        <Button type="button" size="small" buttonStyle="secondary" onClick={() => setRevision(value => value + 1)}>Повторить загрузку авторов</Button>
      </> : authors.length ? authors.map(author => <AuthorRow key={`${id}-${data?.updatedAt}-${revision}-${author.id}`} author={author} api={config.routes.api} />) : <p>Сохранённых авторов пока нет.</p>}
    </>}
  </section>
}
