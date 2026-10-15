const configured = process.env.SERVER_URL?.trim()

if (!configured && process.env.NODE_ENV === 'production') {
  throw new Error('Set SERVER_URL to the public application origin in production.')
}

const url = new URL(configured || 'http://localhost:3000')
const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

if (
  !['http:', 'https:'].includes(url.protocol) ||
  url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
  (url.protocol !== 'https:' && !local)
) {
  throw new Error('SERVER_URL must be an HTTPS origin, or an HTTP localhost origin for local checks.')
}

export const serverURL = url.origin
export const secureCookies = url.protocol === 'https:'
