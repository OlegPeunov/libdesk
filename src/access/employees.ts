import { APIError, type Access, type CollectionBeforeDeleteHook, type FieldAccess } from 'payload'

import { isAdmin, isEmployee } from './roles'

const sameID = (a: unknown, b: unknown) => a !== undefined && b !== undefined && String(a) === String(b)

export const readEmployees: Access = ({ id, req }) => {
  if (!isEmployee({ req })) return false
  if (isAdmin({ req })) return true
  if (id !== undefined && !sameID(id, req.user?.id)) return false
  return { id: { equals: req.user!.id } }
}

export const updateEmployees: Access = ({ data, id, req }) => {
  if (!isEmployee({ req })) return false
  const user = req.user!

  // Collection access runs before field access strips forbidden fields. Reject
  // direct escalation attempts explicitly, including bulk update requests.
  if (isAdmin({ req })) {
    if (data?.role !== undefined && data.role !== user.role) {
      if (sameID(id, user.id)) return false
      return { id: { not_equals: user.id } }
    }
    return true
  }

  if (id !== undefined && !sameID(id, user.id)) return false
  for (const field of ['role', 'email', 'id', 'createdAt', 'updatedAt'] as const) {
    if (data?.[field] !== undefined && String(data[field]) !== String(user[field])) return false
  }
  return { id: { equals: user.id } }
}

export const deleteEmployees: Access = ({ id, req }) => {
  if (!isAdmin({ req }) || sameID(id, req.user?.id)) return false
  return { id: { not_equals: req.user!.id } }
}

export const updateRole: FieldAccess = ({ doc, id, req }) =>
  isAdmin({ req }) && !sameID(id ?? doc?.id, req.user?.id)

export const protectOwnAccount: CollectionBeforeDeleteHook = ({ id, req }) => {
  if (sameID(id, req.user?.id)) throw new APIError('Нельзя удалить собственный аккаунт.', 403)
}
