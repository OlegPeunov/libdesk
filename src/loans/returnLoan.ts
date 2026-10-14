import { APIError, type Endpoint } from 'payload'

import { isEmployee } from './access'

export const returnLoan: Endpoint = {
  path: '/:id/return',
  method: 'post',
  handler: async (req) => {
    if (!isEmployee({ req })) throw new APIError('Для возврата книги войдите как сотрудник.', 401)
    const rawID = req.routeParams?.id
    const id = Number(rawID)
    if (!rawID || !Number.isSafeInteger(id) || id <= 0) throw new APIError('Некорректный номер выдачи.', 400)

    const readLoan = () => req.payload.findByID({ collection: 'loans', id, depth: 0, overrideAccess: false, req })
    const existing = await readLoan()
    if (existing.returnedAt) return Response.json({ doc: existing })

    try {
      const doc = await req.payload.update({
        collection: 'loans',
        id,
        data: { returnedAt: new Date().toISOString() },
        depth: 0,
        overrideAccess: false,
        overrideLock: false,
        req,
      })
      return Response.json({ doc })
    } catch (error) {
      // A concurrent return can close the loan between the read and UPDATE.
      // A retry reads the committed date; it never writes another timestamp.
      if (error instanceof APIError && (error.data?.reason === 'loan_closed' || error.status === 403)) {
        const latest = await readLoan()
        if (latest.returnedAt) return Response.json({ doc: latest })
      }
      throw error
    }
  },
}
