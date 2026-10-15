import sharp from 'sharp'

// Fictional bibliography and readers, not imported personal data or a real ISBN catalogue.
export const authorNames = [
  'Анна Белова', 'Михаил Ветров', 'Елена Соколова', 'Дмитрий Лавров', 'Ирина Волкова',
  'Алексей Морозов', 'Мария Лескова', 'Павел Орлов', 'Ольга Миронова', 'Сергей Крылов',
  'Наталья Рощина', 'Андрей Серов', 'Вера Рябинина', 'Илья Громов', 'Татьяна Лукина',
  'Роман Снегирёв', 'Светлана Березина', 'Никита Зорин', 'Людмила Тихонова', 'Виктор Поляков',
  'Дарья Озерова', 'Константин Власов', 'Алина Цветкова', 'Борис Седов', 'Евгения Романова',
  'Леонид Соловьёв', 'Полина Фомина', 'Вадим Ковалёв', 'Ксения Нестерова', 'Глеб Данилов',
]
export const titles = [
  'Город на берегу ветра', 'Сад за старым домом', 'Письма из северного порта',
  'Практика городского сада', 'Математика повседневных решений', 'Карта тихих улиц',
  'Мастерская хороших историй', 'Поезда ранней осени', 'Архитектура небольших систем',
  'Наблюдая за птицами', 'Разговоры о музыке', 'Свет в окне мастерской',
  'Путеводитель по ночному небу', 'Реки и мосты', 'Основы фотографии в путешествии',
  'Вкус домашнего хлеба', 'Лес после дождя', 'История одного маяка',
  'Заметки полевого биолога', 'Программирование понятных интерфейсов', 'Дом у трёх озёр',
  'Как читать старые карты', 'Керамика: от глины к чашке', 'Планирование без спешки',
  'Семь прогулок по городу', 'Словарь любознательного читателя', 'Время собирать камни',
  'Человек и океан', 'Дневник книжного клуба', 'Маленькая история больших открытий',
]
const firstNames = ['Александр', 'София', 'Максим', 'Анна', 'Артём', 'Мария', 'Иван', 'Ева', 'Даниил', 'Алиса', 'Матвей', 'Варвара', 'Денис', 'Виктория', 'Марк', 'Арина', 'Пётр', 'Елизавета', 'Тимофей', 'Василиса']
const lastNames = ['Иванов', 'Петрова', 'Смирнов', 'Кузнецова', 'Попов', 'Соколова', 'Лебедев', 'Новикова', 'Козлов', 'Морозова', 'Павлов', 'Семёнова', 'Егоров', 'Зайцева', 'Волков', 'Фёдорова', 'Макаров', 'Андреева', 'Михайлов', 'Алексеева']
const pad = (value: number, length = 3) => String(value).padStart(length, '0')
const day = 86_400_000

export function plan(namespace: string, anchor: string) {
  const marker = (key: string) => `[DEMO:${namespace}:${key}]`
  const code = (key: string) => `LD-DEMO-${namespace}-${key}`
  const date = (days: number) => new Date(Date.parse(anchor) + days * day).toISOString()
  const authors = authorNames.map((name, index) => ({ key: `A${pad(index + 1, 2)}`, name: `${marker(`A${pad(index + 1, 2)}`)} ${name}` }))
  const media = titles.slice(0, 12).map((title, index) => ({ key: `C${pad(index + 1, 2)}`, title, index, alt: `${marker(`C${pad(index + 1, 2)}`)} Демонстрационная обложка «${title}»` }))
  const books = Array.from({ length: 150 }, (_, index) => {
    const edition = Math.floor(index / 5)
    const digits = `978500${pad(edition + 1, 6)}`
    const check = (10 - [...digits].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10) % 10
    return {
      key: `B${pad(index + 1)}`, title: titles[edition], inventoryNumber: code(`B${pad(index + 1)}`),
      isbn: digits + check, authors: [authors[edition].key, ...(edition % 4 === 0 ? [authors[(edition + 1) % 30].key] : [])],
      photo: edition < 12 ? media[edition].key : undefined,
    }
  })
  const members = Array.from({ length: 80 }, (_, index) => ({
    key: `M${pad(index + 1)}`, name: `${firstNames[index % 20]} ${lastNames[(index % 20 + Math.floor(index / 20) * 2) % 20]}`,
    cardNumber: code(`M${pad(index + 1)}`), email: index % 5 === 0 ? undefined : `reader${pad(index + 1)}.${namespace}@example.com`,
  }))
  const loans: { key: string; book: string; member: string; issuedAt: string; dueAt: string; returnedAt: string | null }[] = Array.from({ length: 240 }, (_, index) => {
    const book = Math.floor(index / 2)
    const round = index % 2
    const issued = -(round ? 70 + book % 15 : 160 + book % 20)
    return { key: `L${pad(index + 1)}`, book: books[book].key, member: members[(book * 7 + round * 13) % 80].key,
      issuedAt: date(issued), dueAt: date(issued + 21), returnedAt: date(issued + (round ? 12 + book % 12 : 10 + book % 9)) }
  })
  for (let index = 0; index < 60; index++) {
    const issued = -(14 + index % 7)
    loans.push({ key: `L${pad(241 + index)}`, book: books[index].key, member: members[(index * 3 + 9) % 80].key,
      issuedAt: date(issued), dueAt: date(issued + (index < 30 ? 35 : 7)), returnedAt: null })
  }
  return { authors, media, books, members, loans, marker, code }
}

export async function cover(index: number): Promise<Buffer> {
  const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
  const words = titles[index].split(' ')
  const lines: string[] = ['']
  for (const word of words) {
    if ((lines.at(-1)!.length + word.length) > 21) lines.push('')
    lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word
  }
  const colours = ['#284b63', '#606c38', '#6d597a', '#9c6644', '#1b4965', '#805d93', '#386641', '#9b2226', '#457b9d', '#7f5539', '#5f6f52', '#355070']
  // SVG is an in-memory drawing source only. Media receives an actual decoded PNG.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840">
    <rect width="600" height="840" fill="${colours[index]}"/>
    <rect x="28" y="28" width="544" height="784" rx="8" fill="none" stroke="#e9edc9" stroke-width="2"/>
    <text x="60" y="102" fill="#fefae0" font-family="sans-serif" font-size="23">LIBDESK · ДЕМО</text>
    <path d="M60 145h480" stroke="#e9edc9"/>
    ${lines.map((line, i) => `<text x="60" y="${270 + i * 58}" fill="#ffffff" font-family="sans-serif" font-weight="bold" font-size="36">${escape(line)}</text>`).join('')}
    <text x="60" y="660" fill="#fefae0" font-family="sans-serif" font-size="23">${escape(authorNames[index])}</text>
    <text x="60" y="746" fill="#e9edc9" font-family="sans-serif" font-size="18">Демонстрационное издание · ${String(index + 1).padStart(2, '0')}</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
