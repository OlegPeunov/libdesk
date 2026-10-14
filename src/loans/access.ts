import type { Access, CollectionBeforeDeleteHook, PayloadRequest } from 'payload'
import { APIError } from 'payload'

export const isEmployee = ({ req }: { req: PayloadRequest }): boolean => req.user?.collection === 'employees'

async function hasLoanHistory(req: PayloadRequest, field: 'book' | 'member', id: number | string) {
  const history = await req.payload.find({
    collection: 'loans',
    where: { [field]: { equals: id } },
    limit: 1,
    depth: 0,
    overrideAccess: false,
    req,
  })

  return history.totalDocs > 0
}

export function canDeleteWithNoLoans(field: 'book' | 'member'): Access {
  return async ({ id, req }) => {
    if (!isEmployee({ req })) return false
    return id === undefined || !(await hasLoanHistory(req, field, id))
  }
}

export function protectLoanHistory(field: 'book' | 'member'): CollectionBeforeDeleteHook {
  return async ({ id, req }) => {
    if (await hasLoanHistory(req, field, id)) {
      throw new APIError('Нельзя удалить книгу или читателя с историей выдач.', 409)
    }
  }
}

export const neverDeleteLoan: CollectionBeforeDeleteHook = () => {
  throw new APIError('Выдачи сохраняются в истории и не могут быть удалены.', 403)
}
