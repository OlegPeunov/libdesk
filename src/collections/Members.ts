import type { CollectionConfig } from 'payload'
import { canDeleteWithNoLoans, protectLoanHistory } from '../loans/access'

export const Members: CollectionConfig = {
  slug: 'members',
  labels: {
    singular: 'Member',
    plural: 'Members',
  },
  admin: {
    useAsTitle: 'name',
    description: 'Library reader cards. Members do not have login accounts.',
    defaultColumns: ['name', 'cardNumber', 'email'],
    listSearchableFields: ['name', 'cardNumber', 'email'],
  },
  defaultSort: 'name',
  access: { delete: canDeleteWithNoLoans('member') },
  hooks: { beforeDelete: [protectLoanHistory('member')] },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'The reader’s name.',
      },
    },
    {
      name: 'cardNumber',
      label: 'Card Number',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'The unique number of this reader’s library card.',
      },
    },
    {
      name: 'email',
      type: 'email',
      admin: {
        description: 'Optional contact email for the reader. This is not a login.',
      },
    },
  ],
}
