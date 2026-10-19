import type { FormContext } from './context'

const technicalTerms = ['ISBN', 'JPEG', 'JPG', 'PNG', 'WebP', 'MB', 'MiB', 'KB', 'KiB', 'MP', 'px', 'ID', 'UTC', 'S3', 'R2', 'Payload', 'LibDesk']

/** Conservative script/proportion heuristic, NOT language identification or a factuality check. */
export function passesRussianScriptCheck(answer: string, context: FormContext): boolean {
  const text = answer.normalize('NFKC')
  if (/\b(?:user|content|prompt|response)\s+safety\s*[:：]|<\/?(?:think|analysis)>/i.test(text)) return false
  if (/^(?:safe|unsafe|безопасно|небезопасно)[.!]?$/i.test(text.trim())) return false

  // A Russian prefix must not hide Han, Kana, etc., even inside quoted examples.
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.some(letter => !/[\p{Script=Cyrillic}\p{Script=Latin}]/u.test(letter))) return false

  const terms = new Set([...technicalTerms, context.collection, ...context.fields.map(field => field.name)].map(term => term.toLowerCase()))
  const prose = text
    // ASCII email / inventory examples are values, not natural-language prose.
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ')
    .replace(/\b[A-Z]{2,}[-_]\d[A-Z\d_-]*\b/g, ' ')
    .replace(/[\p{L}\p{N}_]+/gu, word => terms.has(word.toLowerCase()) || terms.has(word.replace(/^\d+/, '').toLowerCase()) ? ' ' : word)

  const counts = (value: string) => {
    const letters = value.match(/\p{L}/gu) ?? []
    return { total: letters.length, cyrillic: letters.filter(letter => /\p{Script=Cyrillic}/u.test(letter)).length }
  }
  const whole = counts(prose)
  if (whole.cyrillic < 12 || whole.cyrillic / whole.total < 0.8) return false
  // Also reject an English paragraph/sentence padded with a longer Russian paragraph.
  return prose.split(/\n+|[.!?](?:\s+|$)/u).every(part => {
    const count = counts(part)
    return count.total < 20 || count.cyrillic / count.total >= 0.8
  })
}
