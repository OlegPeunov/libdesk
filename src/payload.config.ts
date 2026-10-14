import { postgresAdapter } from '@payloadcms/db-postgres'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from 'payload'

import { Authors } from './collections/Authors'
import { Books } from './collections/Books'
import { Employees } from './collections/Employees'

const dirname = path.dirname(fileURLToPath(import.meta.url))

function requiredEnv(name: 'DATABASE_URL' | 'PAYLOAD_SECRET'): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Set ${name} in your local .env file. See README.md for setup instructions.`)
  }

  return value
}

const serverURL = process.env.SERVER_URL || 'http://localhost:3000'

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
  collections: [Employees, Authors, Books],
  db: postgresAdapter({
    pool: {
      connectionString: requiredEnv('DATABASE_URL'),
    },
    push: false,
    disableCreateDatabase: true,
    migrationDir: path.resolve(dirname, 'migrations'),
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
