import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { APIError, Forbidden, ValidationError, type CollectionBeforeOperationHook } from 'payload'
import sharp from 'sharp'
import { isEmployee } from '../access/roles'

export const MAX_FILE_BYTES = 3 * 1024 * 1024
export const MAX_IMAGE_SIDE = 4096
export const MAX_IMAGE_PIXELS = 16_000_000
export const MEDIA_PREFIX = 'libdesk/media'
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function invalid(message: string): never {
  throw new ValidationError({ collection: 'media', errors: [{ path: 'file', message }] })
}

export async function validateImage(buffer: Buffer, mime: string, filename: string) {
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) invalid('Изображение должно быть не больше 3 МиБ.')
  const format = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpeg'
    : buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
      : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : undefined
  const extensions = { jpeg: ['.jpg', '.jpeg'], png: ['.png'], webp: ['.webp'] }
  if (!format || mime !== `image/${format}` || !extensions[format].includes(path.extname(filename).toLowerCase())) {
    invalid('Допустимы только настоящие JPEG, PNG и WebP с соответствующими MIME и расширением.')
  }
  try {
    const options = { failOn: 'warning' as const, limitInputPixels: MAX_IMAGE_PIXELS }
    const meta = await sharp(buffer, options).metadata()
    if (meta.format !== format || !meta.width || !meta.height || meta.width > MAX_IMAGE_SIDE || meta.height > MAX_IMAGE_SIDE || meta.width * meta.height > MAX_IMAGE_PIXELS || (meta.pages ?? 1) !== 1) {
      invalid('Предел: 4096 пикселей по каждой стороне и 16 мегапикселей. Анимация не поддерживается.')
    }
    // metadata() alone does not detect truncated/corrupted pixel data.
    await sharp(buffer, options).raw().toBuffer()
  } catch (error) {
    if (error instanceof ValidationError) throw error
    invalid('Изображение повреждено, не декодируется или превышает предел 16 мегапикселей.')
  }
}

/** Runs before Payload generates thumbnails or calls the storage plugin. */
export const prepareMedia: CollectionBeforeOperationHook<'media'> = async ({ args, operation, req }) => {
  if (operation !== 'create' && operation !== 'update' && operation !== 'updateByID') return
  if (!args.overrideAccess && !isEmployee({ req })) throw new Forbidden(req.t)
  if (!(await req.transactionID)) throw new APIError('Для сохранения фотографии требуется транзакция PostgreSQL.', 500)
  // Do not accept cloud-plugin transport state supplied by a Local API caller.
  // The plugin rebuilds it from the validated req.file in beforeChange.
  if (req.context) {
    delete req.context._payloadCloudStorage
    delete req.context.skipCloudStorage
  }
  // Generated storage identity is server-owned, even for Local API calls. No URL
  // imports, disk paths, crop re-fetches, client receipts or caller-chosen prefixes.
  args.data = { ...(args.data?.alt !== undefined ? { alt: args.data.alt } : {}) }
  if (req.file) {
    if (req.file.tempFilePath || !Buffer.isBuffer(req.file.data) || req.file.clientUploadContext) invalid('Загрузите файл через форму; обработка выполняется только в памяти сервера.')
    if (req.file.size !== req.file.data.length) invalid('Размер файла не соответствует содержимому.')
    await validateImage(req.file.data, req.file.mimetype, req.file.name)
    const base = path.parse(path.basename(req.file.name)).name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120) || 'photo'
    req.file.name = `${base}-${randomUUID()}${path.extname(req.file.name).toLowerCase()}`
    args.overwriteExistingFiles = false
  } else if (operation === 'create') invalid('Для создания Media требуется файл JPEG, PNG или WebP.')
}
