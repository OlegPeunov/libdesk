import type { CollectionConfig } from 'payload'

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
  fields: [
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
