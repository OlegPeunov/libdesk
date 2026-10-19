import { HelpError } from './openrouter'

/** Per-process guard, not a distributed quota. OpenRouter key limits cap total spend. */
export function createHelpLimiter() {
  const windows = new Map<string, { until: number; count: number; active: boolean }>()
  return (userID: string, now = Date.now()) => {
    for (const [id, window] of windows) if (window.until <= now && !window.active) windows.delete(id)
    let window = windows.get(userID)
    if (!window) {
      if (windows.size >= 1000) throw new HelpError('busy', 'AI-помощник занят. Попробуйте позже.', 429)
      window = { until: now + 60_000, count: 0, active: false }; windows.set(userID, window)
    }
    if (window.active || window.count >= 5) throw new HelpError('rate_limit', 'Не больше пяти вопросов в минуту и одного одновременно. Подождите немного.', 429)
    window.active = true; window.count++
    return () => { window.active = false }
  }
}
