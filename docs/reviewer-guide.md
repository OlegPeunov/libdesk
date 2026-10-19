# Reviewer walkthrough

LibDesk tracks **physical book copies**, reader cards and lending history. Employee
accounts are separate from readers. Reviewer credentials are supplied privately;
they are not included in the repository or demo seed.

The generated Payload interface is retained. Some custom controls and validation
messages are currently in Russian; the labels below identify the relevant controls.

## Five-minute tour

1. Sign in as **Admin** at `/admin/login`. Open Books and search an inventory number
   such as `LD-DEMO-review-B001` in the published demo, or `LD-DEMO-v1-B001` after the
   default local seed. Search also accepts a book title. Use standard Filters to
   narrow a list. Books represent individual copies: a title / ISBN can repeat,
   but inventory numbers cannot.
2. Open a book with a photograph. The original and thumbnail are private R2 objects.
   A signed-in employee can view them; copying the file URL into a signed-out
   session does not grant access. Permitted uploads are JPEG, PNG and WebP up to
   3 MiB, 4096 pixels per side and 16 megapixels in total.
3. In the book's **Авторы: редактирование на странице** section, edit an author's
   name and click **Сохранить автора** (Save author). This updates the shared Author
   immediately without saving the surrounding Book. The normal author selector
   and drawer remain available for creating and selecting related records.
4. Open a reader under Members. **Выдачи читателя** (Reader loans) is a paginated
   related-record table. Edit an active loan's due date and click **Сохранить срок**
   (Save due date). Closed loans are read-only. Each row saves independently of the
   reader form and links to the complete Loan record.
5. Open Loans. **Активные** means Active, **Возвращённые** Returned,
   **Просроченные** Overdue and **Все** All. Overdue means `dueAt < now` with no
   `returnedAt`. Open an active loan and click **Вернуть книгу** (Return book).
   The action sets the server timestamp and preserves the row in history. A second
   return does not change that timestamp. The copy can then be lent again.
6. Sign out at `/admin/logout`, then sign in as **Librarian**. Staff administration
   and deletion are unavailable. Catalog maintenance, lending, returns and the two
   inline editors still work. Account allows the librarian to change their own
   name and password, not their role or another employee's account.
7. Open **AI-помощник по полям** in the published release
   at the top of a Book or Loan form. Choose ISBN / inventory number or Due At,
   ask how to fill it out, and compare the answer with the displayed real field
   description. The helper never saves the form or changes library records.

To create a loan, choose a copy without an active loan. A second active loan for
the same copy is rejected, including two concurrent requests. Dates and immutable
fields are checked on the server. Loans cannot be deleted; a book or reader with
loan history cannot be deleted either, even by Admin.

## Demo dataset

Each complete namespace contains 30 authors, 150 copies (30 fictional editions,
five copies each), 80 readers, 300 loans and 12 generated cover images. There are
240 returned loans, 60 active loans and initially 30 overdue loans. Dates are
anchored to the initial seed run; counts of overdue loans naturally change over
time. The seed is fictional data, not imported reader information or a real ISBN
catalogue. Sixty books have a cover; some editions have multiple authors.

`pnpm seed` creates the default `v1` namespace locally; `pnpm seed:check` verifies
it. Re-running seed does not duplicate records. Reset requires an explicit
confirmation and the local ignored ownership journal. Preserve `.libdesk-demo/`
for maintenance; it is not a server-side upload store. See the detailed seed
documentation before resetting a dataset. Live demo resets are not exposed as an
HTTP endpoint or admin action.

## Implementation map

| Concern | Location |
| --- | --- |
| Collection definitions and generated admin settings | `src/collections/` |
| Role and employee access rules | `src/access/` |
| Loan validation, concurrency and return action | `src/loans/` |
| Partial unique index and restrictive references | `src/database/loanSchema.ts` and migrations |
| Image validation, private storage and failure handling | `src/media/` |
| Two inline editors and return button | `src/components/` |
| Deterministic seed / scoped maintenance CLI | `scripts/demo.ts`, `scripts/demo/data.ts` |
| Real API / PostgreSQL / R2 integration checks | `tests/` |

Tests include simultaneous issuance, repeated and competing returns, immutable
history, direct role escalation attempts, anonymous access, CSRF, image validation,
private file access and inline-update endpoints. They target a local server and
create isolated fixtures; they must not be pointed at the public application.
