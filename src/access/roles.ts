import type { PayloadRequest } from 'payload'

type RequestArgs = { req: Pick<PayloadRequest, 'user'> }

export const isEmployee = ({ req }: RequestArgs): boolean =>
  req.user?.collection === 'employees' && (req.user.role === 'admin' || req.user.role === 'librarian')

export const isAdmin = ({ req }: RequestArgs): boolean =>
  isEmployee({ req }) && req.user?.role === 'admin'
