# LibDesk

An internal library desk for a catalog of **physical book copies**, reader cards and
lending history. Built with Next.js, TypeScript, Payload CMS, managed PostgreSQL
(Neon) and private S3-compatible object storage (Cloudflare R2).

**Live demo:** deployment is prepared; Vercel account authorization is still required.
**Source:** [OlegPeunov/libdesk](https://github.com/OlegPeunov/libdesk).
Reviewer credentials are provided privately, never committed.

- [Five-minute reviewer walkthrough](docs/reviewer-guide.md)
- [Deployment and operational limits](docs/deployment.md)
- [Take-home requirement map](docs/requirements.md)
- [Detailed development / test / seed instructions in Russian](docs/development-notes.ru.md)

## What it does

- Maintain authors, copies, reader cards and private photographs in the generated Payload admin.
- Search and filter lists; edit related authors inside a Book and loan due dates inside a Member.
- Issue a copy, extend an active loan and return it with a custom admin action.
- Keep immutable returned-loan history. A PostgreSQL partial unique index prevents two active
  loans for one copy, including concurrent requests; transaction row locks protect updates.
- Enforce Admin / Librarian permissions on the server and in the admin controls.

Readers are not employee logins. A Book is one physical copy with a unique inventory number;
multiple copies may share a title and ISBN. Books and Authors have a many-to-many relationship.

## Local setup

Use Node.js **24.21.0** and pnpm **11.25.0** (pinned in `.nvmrc` and `packageManager`).
Payload is **3.90.2**, Next.js **16.4.0**, React **19.3.0**. Exact dependencies are locked.

```sh
nvm install
nvm use
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
```

Fill `.env` with an empty managed development PostgreSQL database and private R2 bucket:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL, preserving the provider's TLS settings |
| `PAYLOAD_SECRET` | Random local secret, e.g. generated with `openssl rand -hex 32` |
| `SERVER_URL` | `http://localhost:3000` locally; exact HTTPS origin when deployed |
| `R2_BUCKET`, `R2_ENDPOINT` | Private bucket and its S3 API origin |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Bucket-scoped object read/write credentials |

All seven variables are required in production. There is no local database or upload fallback.
Never commit real values. Then:

```sh
pnpm migrate
pnpm migrate:status
pnpm dev
```

Open [localhost:3000/admin](http://localhost:3000/admin). In the first-user form, **explicitly
select Role → Admin**; the default is Librarian. After the first employee, public initial
registration closes. Admin creates subsequent employees through Employees. Logout is
`/admin/logout`. Automatic database schema push is disabled; apply existing migrations.

## Demo data

After creating an Admin, run locally:

```sh
pnpm seed
pnpm seed:check
# Destructive only to this tracked demo namespace; requires its ownership journal:
pnpm seed:reset -- --confirm
```

The deterministic fictional dataset contains **30 authors, 150 copies, 80 readers, 300 loans
and 12 covers**. Initially it has 240 returned loans, 60 active loans and 30 overdue loans.
There are five copies per edition, books with multiple authors, and 60 copies with photographs.
Re-running seed reuses the existing dataset. Dates are anchored to its first run.

Keys use `LD-DEMO-<namespace>-...` and `[DEMO:<namespace>:...]` markers. The ignored local
`.libdesk-demo/` ownership journal is required for reset and must be retained. Reset refuses
ambiguous ownership or outside references and never clears the database or entire bucket.
The published demo uses the `review` namespace; local seed defaults to `v1`.
See the detailed notes for namespace arguments, recovery and scoped reset behavior.

## Roles and security

| Capability | Admin | Librarian |
| --- | --- | --- |
| Maintain authors, books, members and photographs | Yes | Yes |
| Issue, extend and return active loans | Yes | Yes |
| Delete unused catalog records / photographs | Yes | No |
| Manage other employees and roles | Yes | No |
| Change own name / password | Yes | Yes |
| Delete loan history or edit a closed loan | No | No |

Accounts cannot delete themselves or change their own role. Librarians see only their own
account. Server collection/field access, not hidden buttons alone, enforces these rules.
Payload handles password hashing and sessions. Cookies are HttpOnly / SameSite=Lax and Secure
on HTTPS. CORS/CSRF use the configured origin. Anonymous data and file access are denied.

Uploads are decoded and validated server-side: JPEG/PNG/WebP, at most 3 MiB, 4096 pixels per
side, 16 megapixels, no animation. Original and thumbnail stay in R2; processing uses memory.
Private downloads use Payload access checks and `private, no-store` responses. UUID names
avoid collisions. Used photographs cannot be deleted; removing a book preserves its photo.

## Checks

```sh
pnpm check                 # fast: configuration tests and TypeScript
pnpm test:loans            # focused integration suite, local app + matching DB required
pnpm test:access
pnpm test:media
pnpm test:media:unavailable
pnpm test:inline
pnpm test                 # complete integration run before release
pnpm build
pnpm start
```

Integration tests require a running local server and real test PostgreSQL / R2 settings.
They create scoped fixtures and clean up only those records and objects. Do not target the
live demo or run suites concurrently. Run focused checks during development and one complete
suite / production build before release. See detailed notes for isolated production checks.

## Design decisions and scope

Payload provides authentication, forms, lists and REST operations in the same Next.js app;
custom code extends its admin rather than building another admin frontend. PostgreSQL fits
relational lending history and database-enforced concurrency. Neon and R2 meet the managed
DB / external object-storage requirements without a separate backend service. GraphQL is off.

Deliberately omitted: OAuth, the optional AI field assistant (no model provider/key configured),
reservations, fines, notification delivery, public reader accounts and a separate edition model.
Custom controls/messages currently use Russian alongside Payload's English defaults.

With more time: unified UI localization, a grounded field-help assistant, outbound email,
monitoring/backups and storage reconciliation. PostgreSQL and R2 have no shared transaction;
crashes or partial failures can leave objects or file references needing repair. Recovery
attempts are scoped, but there is no background reconciler. Password-reset email delivery
is not configured. These limitations are described in the deployment guide.
