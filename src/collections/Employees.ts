import type { CollectionConfig } from 'payload'

export const Employees: CollectionConfig = {
  slug: 'employees',
  labels: {
    singular: 'Employee',
    plural: 'Employees',
  },
  auth: true,
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['name', 'email', 'updatedAt'],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      maxLength: 200,
      admin: {
        description: 'The staff member’s name. This is an employee login, not a reader card.',
      },
    },
  ],
}
