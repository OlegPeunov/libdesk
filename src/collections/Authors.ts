import type { CollectionConfig } from 'payload'
import { isAdmin, isEmployee } from '../access/roles'
import { fieldAssistant } from '../ai/context'

export const Authors: CollectionConfig = {
  slug: 'authors',
  labels: {
    singular: 'Author',
    plural: 'Authors',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'updatedAt'],
    listSearchableFields: ['name'],
  },
  defaultSort: 'name',
  access: { create: isEmployee, read: isEmployee, update: isEmployee, delete: isAdmin },
  fields: [
    fieldAssistant,
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'The author’s name. Author records can be shared by multiple books.',
      },
    },
  ],
}
