import type { CollectionConfig } from 'payload'

export const Books: CollectionConfig = {
  slug: 'books',
  labels: {
    singular: 'Book',
    plural: 'Books',
  },
  admin: {
    useAsTitle: 'title',
    description: 'Each record represents one physical copy of a book.',
    defaultColumns: ['title', 'inventoryNumber', 'authors', 'isbn'],
    listSearchableFields: ['title', 'inventoryNumber'],
  },
  defaultSort: 'title',
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'The book’s title. Multiple physical copies may have the same title.',
      },
    },
    {
      name: 'inventoryNumber',
      label: 'Inventory Number',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'The unique inventory number assigned to this physical copy.',
      },
    },
    {
      name: 'isbn',
      label: 'ISBN',
      type: 'text',
      admin: {
        description: 'Optional ISBN. Multiple physical copies may share the same ISBN.',
      },
    },
    {
      name: 'authors',
      type: 'relationship',
      relationTo: 'authors',
      hasMany: true,
      admin: {
        allowCreate: true,
        allowEdit: true,
        description: 'Choose one or more authors, or create an author here. Editing an author changes the shared record for every related book.',
      },
    },
  ],
}
