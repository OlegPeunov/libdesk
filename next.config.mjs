import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep Payload error classes identical across admin SSR and REST handlers.
  // Separate bundled copies lose ValidationError field details in production.
  serverExternalPackages: ['payload'],
  async headers() {
    return [{ source: '/api/media/file/:path*', headers: [
      { key: 'Cache-Control', value: 'private, no-store, max-age=0, must-revalidate' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
      { key: 'Vary', value: 'Cookie, Authorization, Origin' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
    ] }]
  },
  async redirects() {
    return [{ source: '/', destination: '/admin', permanent: false }]
  },
}

export default withPayload(nextConfig)
