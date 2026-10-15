import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { s3Storage } from '@payloadcms/storage-s3'
import { APIError, type CollectionConfig, type Plugin } from 'payload'
import { MEDIA_PREFIX } from './image'

export function privateFileHeaders(headers: Headers): Headers {
  headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate')
  headers.set('CDN-Cache-Control', 'no-store')
  headers.set('Vary', 'Cookie, Authorization, Origin')
  headers.set('X-Content-Type-Options', 'nosniff')
  return headers
}

export function r2Settings() {
  const env = (name: string) => {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`Set ${name} in the local environment. See README.md.`)
    return value
  }
  const endpoint = env('R2_ENDPOINT')
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('R2_ENDPOINT must be an HTTPS S3 service origin without a bucket path or query.')
  return {
    bucket: env('R2_BUCKET'),
    config: {
      endpoint, region: 'auto', forcePathStyle: true,
      credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 15_000 },
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    },
  }
}

type StoredFiles = { filename?: string | null; sizes?: Record<string, { filename?: string | null } | null> | null }
export const mediaKeys = (doc: StoredFiles) => [doc.filename, ...Object.values(doc.sizes ?? {}).map(size => size?.filename)]
  .filter((name): name is string => Boolean(name)).map(name => {
    if (name.includes('/') || name.includes('\\')) throw new Error('Invalid stored filename.')
    return `${MEDIA_PREFIX}/${name}`
  })

const unavailable = () => new APIError('Хранилище фотографий временно недоступно. Изменения не сохранены; повторите попытку позже.', 503, undefined, true)

/** Official S3 transport, with explicit failure handling around its hooks. */
export const privateMediaStorage: Plugin = async incoming => {
  const { bucket, config } = r2Settings()
  const client = new S3Client(config)
  const configured = await s3Storage({ bucket, config, collections: { media: { prefix: MEDIA_PREFIX } }, clientUploads: false, signedDownloads: false })(incoming)
  return {
    ...configured,
    collections: configured.collections?.map((collection): CollectionConfig => {
      if (collection.slug !== 'media' || !collection.upload || typeof collection.upload !== 'object') return collection
      const uploadHooks = collection.hooks?.afterChange ?? []
      return {
        ...collection,
        fields: collection.fields.map(field => field.type === 'text' && field.name === 'prefix' ? { ...field, defaultValue: MEDIA_PREFIX, access: { create: () => false, update: () => false }, admin: { ...field.admin, hidden: true } } : field),
        hooks: {
          ...collection.hooks,
          afterChange: [async args => {
            let doc = args.doc
            try {
              for (const hook of uploadHooks) doc = await hook({ ...args, doc }) || doc
              // The DB transaction cannot commit a successful upload until both
              // the original and every generated thumbnail actually exist in R2.
              for (const Key of mediaKeys(doc)) await client.send(new HeadObjectCommand({ Bucket: bucket, Key }))
              return doc
            } catch {
              // UUID identities make compensation safe: never delete previous files.
              const previous = new Set(mediaKeys(args.previousDoc ?? {}))
              await Promise.allSettled(mediaKeys(args.doc).filter(key => !previous.has(key)).map(Key => client.send(new DeleteObjectCommand({ Bucket: bucket, Key }))))
              throw unavailable()
            }
          }],
          // v3.90.2's stock afterDelete logs and swallows S3 errors. Await them
          // here so a failed deletion rolls back the row and is reported as 503.
          afterDelete: [async ({ doc }) => {
            try {
              await Promise.all(mediaKeys(doc).map(Key => client.send(new DeleteObjectCommand({ Bucket: bucket, Key }))))
            } catch { throw unavailable() }
            return doc
          }],
        },
        upload: {
          ...collection.upload,
          handlers: collection.upload.handlers?.map(handler => async (req, args) => {
            const response = await handler(req, args)
            if (!response) throw unavailable() // Never fall through to local disk.
            if (response.status >= 500) return Response.json({ errors: [{ message: 'Хранилище фотографий временно недоступно. Повторите попытку позже.' }] }, { status: 503, headers: privateFileHeaders(new Headers()) })
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers: privateFileHeaders(new Headers(response.headers)) })
          }),
        },
      }
    }),
  }
}
