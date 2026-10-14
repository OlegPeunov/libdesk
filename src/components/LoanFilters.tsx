'use client'

import { Button, useListQuery } from '@payloadcms/ui'
import type { Where } from 'payload'
import { transformWhereQuery } from 'payload/shared'

export function LoanFilters() {
  const { handleWhereChange } = useListQuery()
  const filter = (where: Where) => {
    // Payload's list controls expect the WhereBuilder's OR/AND shape.
    void handleWhereChange?.(Object.keys(where).length ? transformWhereQuery(where) : {})
  }

  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }} aria-label="Фильтры выдач">
      <Button type="button" size="small" buttonStyle="secondary" onClick={() => filter({})}>Все</Button>
      <Button type="button" size="small" buttonStyle="secondary" onClick={() => filter({ returnedAt: { exists: 'false' } })}>Активные</Button>
      <Button type="button" size="small" buttonStyle="secondary" onClick={() => filter({ returnedAt: { exists: 'true' } })}>Возвращённые</Button>
      <Button type="button" size="small" buttonStyle="secondary" onClick={() => filter({ and: [
        { returnedAt: { exists: 'false' } },
        { dueAt: { less_than: new Date().toISOString() } },
      ] })}>Просроченные</Button>
    </div>
  )
}
