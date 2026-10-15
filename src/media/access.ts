import { APIError, type Access, type CollectionBeforeDeleteHook } from 'payload'
import { isAdmin } from '../access/roles'

const hasBooks = async (req: Parameters<Access>[0]['req'], id: number | string) =>
  (await req.payload.find({ collection: 'books', where: { photo: { equals: id } }, limit: 1, depth: 0, overrideAccess: false, req })).totalDocs > 0

export const deleteUnusedMedia: Access = async ({ id, req }) =>
  isAdmin({ req }) && (id === undefined || !(await hasBooks(req, id)))

export const protectBookPhoto: CollectionBeforeDeleteHook = async ({ id, req }) => {
  if (await hasBooks(req, id)) throw new APIError('Фотография используется книгой. Сначала отвяжите её во всех книгах.', 409)
}
