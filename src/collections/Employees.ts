import type { CollectionConfig } from 'payload'
import { deleteEmployees, protectOwnAccount, readEmployees, updateEmployees, updateRole } from '../access/employees'
import { isAdmin, isEmployee } from '../access/roles'
import { secureCookies } from '../serverURL'

export const Employees: CollectionConfig = {
  slug: 'employees',
  labels: {
    singular: 'Employee',
    plural: 'Employees',
  },
  auth: { cookies: { secure: secureCookies, sameSite: 'Lax' } },
  access: {
    admin: isEmployee,
    create: isAdmin,
    read: readEmployees,
    update: updateEmployees,
    delete: deleteEmployees,
    unlock: isAdmin,
  },
  hooks: { beforeDelete: [protectOwnAccount] },
  disableDuplicate: true,
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['name', 'email', 'role'],
    hidden: ({ user }) => user?.role !== 'admin',
  },
  fields: [
    {
      name: 'email',
      type: 'email',
      access: { update: isAdmin },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      maxLength: 200,
      admin: {
        description: 'The staff member’s name. This is an employee login, not a reader card.',
      },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'librarian',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Librarian', value: 'librarian' },
      ],
      access: { create: isAdmin, read: isEmployee, update: updateRole },
      admin: { description: 'Only an admin can manage another employee’s role. Your own role cannot be changed.' },
    },
  ],
}
