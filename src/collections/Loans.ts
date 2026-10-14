import type { CollectionConfig } from 'payload'

import { isEmployee, neverDeleteLoan } from '../loans/access'
import { enforceLoanRules } from '../loans/rules'
import { returnLoan } from '../loans/returnLoan'

export const Loans: CollectionConfig = {
  slug: 'loans',
  labels: { singular: 'Loan', plural: 'Loans' },
  admin: {
    useAsTitle: 'id',
    description: 'One loan per physical book copy. Returned loans remain in history.',
    defaultColumns: ['book', 'member', 'issuedAt', 'dueAt', 'returnedAt'],
    components: {
      beforeListTable: ['/components/LoanFilters#LoanFilters'],
      edit: { beforeDocumentControls: ['/components/ReturnBookButton#ReturnBookButton'] },
    },
  },
  defaultSort: '-issuedAt',
  disableDuplicate: true,
  access: {
    create: isEmployee,
    read: isEmployee,
    update: ({ req }) => isEmployee({ req }) ? { returnedAt: { exists: false } } : false,
    delete: () => false,
  },
  hooks: {
    beforeChange: [enforceLoanRules],
    beforeDelete: [neverDeleteLoan],
  },
  endpoints: [returnLoan],
  fields: [
    {
      name: 'book',
      type: 'relationship',
      relationTo: 'books',
      required: true,
      index: true,
      admin: { description: 'One physical copy. Cannot be changed after the loan is created.' },
    },
    {
      name: 'member',
      type: 'relationship',
      relationTo: 'members',
      required: true,
      index: true,
      admin: { description: 'The reader borrowing this copy. Cannot be changed after creation.' },
    },
    {
      name: 'issuedAt',
      type: 'date',
      required: true,
      defaultValue: () => new Date().toISOString(),
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Issue date and time. Cannot be changed after creation.',
      },
    },
    {
      name: 'dueAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Must be after issue time. Can be extended while the loan is active.',
      },
    },
    {
      name: 'returnedAt',
      type: 'date',
      index: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Empty means active. A return closes the loan permanently.',
      },
    },
  ],
}
