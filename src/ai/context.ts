import type { SanitizedCollectionConfig, UIField } from 'payload'

export const helpCollections = ['authors', 'books', 'members', 'loans', 'media'] as const

export type HelpField = {
  name: string
  label: string
  description: string
  type: string
  required: boolean
  unique: boolean
  hasMany: boolean
  relationTo?: string | string[]
  maxLength?: number
}
export type FormContext = { collection: string; label: string; description: string; fields: HelpField[] }

/** Only static help from the actual schema. Never serialize documents, access functions or auth fields. */
export function formContext(collection: SanitizedCollectionConfig): FormContext {
  const fields: HelpField[] = []
  for (const field of collection.fields) {
    if (field.type === 'ui' || !('name' in field) || field.admin?.hidden || field.access?.read) continue
    const description = field.admin?.description
    if (typeof description !== 'string' || !description.trim()) continue
    fields.push({
      name: field.name,
      label: typeof field.label === 'string' ? field.label : field.name,
      description,
      type: field.type,
      required: 'required' in field && field.required === true,
      unique: 'unique' in field && field.unique === true,
      hasMany: 'hasMany' in field && field.hasMany === true,
      ...('relationTo' in field ? { relationTo: field.relationTo } : {}),
      ...('maxLength' in field && typeof field.maxLength === 'number' ? { maxLength: field.maxLength } : {}),
    })
  }
  return {
    collection: collection.slug,
    label: typeof collection.labels.singular === 'string' ? collection.labels.singular : collection.slug,
    description: typeof collection.admin.description === 'string' ? collection.admin.description : '',
    fields,
  }
}

// UI-only: no persisted value, generated column or migration.
export const fieldAssistant: UIField = {
  name: 'fieldAssistant',
  type: 'ui',
  admin: { components: { Field: '/components/FieldAssistant#FieldAssistant' } },
}
