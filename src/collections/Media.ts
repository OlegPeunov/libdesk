import type { CollectionConfig } from 'payload'
import { isEmployee } from '../access/roles'
import { deleteUnusedMedia, protectBookPhoto } from '../media/access'
import { IMAGE_MIME_TYPES, MAX_IMAGE_PIXELS, prepareMedia } from '../media/image'
import { privateFileHeaders } from '../media/storage'
import { fieldAssistant } from '../ai/context'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Photo', plural: 'Media' },
  admin: { useAsTitle: 'alt', defaultColumns: ['filename', 'alt', 'mimeType', 'filesize'], description: 'Shared book photographs. Removing a book or its photo link keeps the file.' },
  disableDuplicate: true,
  access: {
    create: isEmployee,
    // A Where result also makes the file endpoint resolve an actual Media row.
    read: ({ req }) => isEmployee({ req }) ? { id: { exists: true } } : false,
    update: isEmployee,
    delete: deleteUnusedMedia,
  },
  hooks: { beforeOperation: [prepareMedia], beforeDelete: [protectBookPhoto] },
  upload: {
    disableLocalStorage: true,
    filesRequiredOnCreate: true,
    mimeTypes: IMAGE_MIME_TYPES,
    pasteURL: false,
    crop: false,
    focalPoint: false,
    constructorOptions: { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' },
    adminThumbnail: 'thumbnail',
    imageSizes: [{ name: 'thumbnail', width: 320, height: 320, fit: 'inside', withoutEnlargement: true }],
    modifyResponseHeaders: ({ headers }) => privateFileHeaders(headers),
  },
  fields: [fieldAssistant, { name: 'alt', type: 'text', required: true, maxLength: 200, admin: { description: 'Describe the photograph for accessibility. Editing this shared record affects every linked book.' } }],
}
