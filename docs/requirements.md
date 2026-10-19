# Take-home requirement map

The four domain models are Author, Book, Member and Loan. Employees provide staff
authentication; Media provides upload infrastructure. One Book is one physical
copy, not a book edition.

| Requirement | Implementation / evidence |
| --- | --- |
| Framework-generated admin | Payload RootPage, collection configuration and standard forms; no separate admin application |
| Foreign-key relationships | Loan → Book / Member; Book → Media |
| Many-to-many relationship | Books ↔ Authors via the generated relationship table |
| Image field and external storage | Books.photo → Media; private R2 through the official S3 adapter, no local-disk fallback |
| Real business logic | One active loan per copy, date validation, immutable history and idempotent return |
| Concurrent issuance protection | PostgreSQL partial unique index in schema and migrations |
| Two customized model lists | Books and Members list columns, search and standard filters; Loans also has quick filters |
| Related inline editing for two models | Books edits Author.name; Members edits active Loan.dueAt on the parent page |
| Custom admin action | Return book button calls the authenticated return endpoint |
| Real authentication and two roles | Payload password hashing / sessions; Admin and Librarian enforced in collection and field access |
| Visibly restricted lower-privilege role | Librarian has no employee-management menu or deletion controls; own Account remains available |
| Security | CSRF origins, HttpOnly / SameSite cookies, Secure cookies over HTTPS, server validation and private downloads |
| Managed database | PostgreSQL adapter; demo / development use managed Neon rather than an embedded database |
| Meaningful reproducible demo data | Deterministic 572-record namespace; seed, check and confirmed scoped reset commands |
| Live deployment / HTTPS / static assets | https://libdesk.vercel.app/admin; public HTTPS / static assets verified during deployment |
| Public source and setup instructions | GitHub repository, root README, deployment guide and detailed development notes |
| Automated tests (bonus) | Loan, access, media, inline and AI integration suites, plus provider mocks and origin/cookie configuration checks |
| OAuth (bonus) | Deliberately omitted; local staff authentication is the implemented login method |
| Grounded AI field assistant (bonus) | UI field in five admin forms; authenticated Payload endpoints build real schema context and call OpenRouter; safe provider errors and focused checks. See README for configuration / release status |

## Scope decisions

- Readers do not log in; library staff maintain their cards and loans.
- No reservation, fines, notifications, edition model or public catalog was added.
- The return action operates on one loan. Bulk return is not required for a custom
  action and was omitted to keep confirmation and error handling simple.
- Dates are stored as timestamps; custom date controls display browser-local time.
- A shared author or photo is a shared record. Editing it affects all linked books.
- PostgreSQL cannot atomically commit object-store changes. Storage reconciliation,
  monitoring, backup operations and outbound email remain future operational work.

The deployment row is a release gate, not a claim that local production checks
alone satisfy public deployment. Reviewer access must be supplied privately once
the HTTPS deployment is available.
