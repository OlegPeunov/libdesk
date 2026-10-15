import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep Payload error classes identical across admin SSR and REST handlers.
  // Separate bundled copies lose ValidationError field details in production.
  serverExternalPackages: ['payload'],
  async redirects() {
    return [{ source: '/', destination: '/admin', permanent: false }]
  },
}

export default withPayload(nextConfig)
