import { postgresAdapter } from '@payloadcms/db-postgres'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'
import sharp from 'sharp'

import { Authors } from './collections/Authors'
import { Books } from './collections/Books'
import { Employees } from './collections/Employees'
import { Members } from './collections/Members'
import { Loans } from './collections/Loans'
import { Media } from './collections/Media'
import { MAX_FILE_BYTES } from './media/image'
import { privateMediaStorage } from './media/storage'
import { loanActiveIndex, loanReferences } from './database/loanSchema'
import { serverURL } from './serverURL'

const dirname = path.dirname(fileURLToPath(import.meta.url))

function requiredEnv(name: 'DATABASE_URL' | 'PAYLOAD_SECRET'): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Set ${name} in your local .env file. See README.md for setup instructions.`)
  }

  return value
}

export default buildConfig({
  admin: {
    user: Employees.slug,
    importMap: {
      baseDir: dirname,
    },
    meta: {
      titleSuffix: '— LibDesk',
    },
  },
  collections: [Employees, Authors, Books, Members, Loans, Media],
  sharp,
  plugins: [privateMediaStorage],
  upload: { useTempFiles: false, abortOnLimit: true, limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 20, fieldSize: 64 * 1024 }, requestSizeLimit: MAX_FILE_BYTES + 128 * 1024, responseOnLimit: 'Изображение должно быть не больше 3 МиБ.' },
  db: postgresAdapter({
    pool: {
      connectionString: requiredEnv('DATABASE_URL'),
    },
    push: false,
    disableCreateDatabase: true,
    migrationDir: path.resolve(dirname, 'migrations'),
    beforeSchemaInit: [loanReferences],
    afterSchemaInit: [loanActiveIndex],
  }),
  secret: requiredEnv('PAYLOAD_SECRET'),
  serverURL,
  csrf: [serverURL],
  cors: [serverURL],
  graphQL: {
    disable: true,
  },
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
