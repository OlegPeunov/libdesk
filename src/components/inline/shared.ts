/** Same-origin REST keeps Payload's cookie authentication, CSRF, access and hooks. */
export async function inlineRequest<T>(url: string, data?: { name: string } | { dueAt: string }, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: data ? 'PATCH' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: signal ?? AbortSignal.timeout(30_000),
    ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Нет доступа. Проверьте вход и права сотрудника. Введённое значение сохранено в строке.')
    const error = body?.errors?.[0]
    throw new Error(error?.data?.errors?.[0]?.message || error?.message || 'Сервер отклонил запрос. Попробуйте ещё раз.')
  }
  if (!body) throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.')
  return body as T
}

export const errorMessage = (error: unknown) => error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)
  ? error.message
  : 'Не удалось связаться с сервером. Проверьте соединение и повторите сохранение.'

/** datetime-local displays local time; keep seconds/milliseconds until the user changes it. */
export function localDateTime(iso: string): string {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1)
}

export function displayDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('ru-RU') : '—'
}

export function relationIDs(values: unknown): string[] {
  return Array.isArray(values) ? values.map(value => String(typeof value === 'object' && value !== null ? value.id : value)).sort() : []
}
