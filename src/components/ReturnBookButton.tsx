'use client'

import { Button, useAuth, useConfig, useDocumentInfo, useFormModified, useFormProcessing } from '@payloadcms/ui'
import { useState } from 'react'

export function ReturnBookButton() {
  const { user } = useAuth()
  const { config } = useConfig()
  const { id, data, hasSavePermission, documentIsLocked } = useDocumentInfo()
  const modified = useFormModified()
  const processing = useFormProcessing()
  const [returning, setReturning] = useState(false)
  const [error, setError] = useState('')

  if (!id || data?.returnedAt || !hasSavePermission || user?.collection !== 'employees') return null

  async function returnBook() {
    if (returning || processing || modified) return
    setReturning(true)
    setError('')
    try {
      const response = await fetch(`${config.routes.api}/loans/${id}/return`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.errors?.[0]?.message || 'Не удалось вернуть книгу. Попробуйте ещё раз.')
      }
      // Re-load Payload's form, document permissions and list data from the server.
      window.location.reload()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось вернуть книгу.')
      setReturning(false)
    }
  }

  return (
    <div>
      <Button type="button" buttonStyle="secondary" disabled={returning || processing || modified || documentIsLocked} onClick={returnBook}>
        {returning ? 'Возвращаем…' : 'Вернуть книгу'}
      </Button>
      {modified && <small>Сначала сохраните изменения выдачи.</small>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
