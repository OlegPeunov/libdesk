# Deploying LibDesk

LibDesk runs as one Next.js / Payload application on Node.js, with managed PostgreSQL
and a private Cloudflare R2 bucket. `vercel.json` selects Frankfurt (`fra1`) to keep
the application near the Neon database. No paid hosting upgrade is required by the
application itself.

## Published review environment

- Application: [https://libdesk.vercel.app/admin](https://libdesk.vercel.app/admin).
- Vercel workspace / project: `lib-desk/libdesk`, Hobby, Node.js 24.x.
- Production `SERVER_URL`: `https://libdesk.vercel.app`.
- Dedicated database: `libdesk_review`; all six existing migrations are applied.
- Seed namespace: `review`; preserve its local `.libdesk-demo/review.json` journal.
- Production variables come from the local `.env.review.local`; `.env` remains
  the separate development environment. Reviewer credentials are not runtime
  environment variables and are never uploaded.
- Vercel Authentication is disabled; Payload authentication and server access
  control protect the application data and private R2 file URLs.

The first deployment was uploaded from the current working directory with
`pnpm dlx vercel@64.0.2 deploy --prod --yes --scope lib-desk`. Vercel performed the
production build and TypeScript check, using Corepack and pnpm 11.25.0. The CLI
dry run confirmed that secrets, local access details and seed journals were
excluded. Never use `vercel env pull` over the development `.env` file.

The local access file is `.libdesk-private/reviewer-access.md` (mode `600`).
Share its contents directly with the reviewer; do not commit or upload it.

The public HTTPS smoke check passed: login and 14 JS/CSS assets, both employee
roles, secure session cookies, server permissions and escalation rejection,
private R2 photo access and anonymous denial, closed first registration, CSRF,
and issuance / idempotent return on temporary records. Temporary lending records
were removed with exact-ID CLI maintenance in the review database; the demo set
was preserved. Full integration tests and a local production build were not
repeated for deployment; Vercel performed the production build.

GitHub repository `OlegPeunov/libdesk` is connected to this existing project.
Vercel's API confirms Git provider `github` and production branch `main`.
Future pushes to `main` are configured for production deployment. A push-triggered
build has not been exercised: no commit or push was performed during deployment.

## Environment

Configure these variables in the hosting project's **Production** environment:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for the dedicated demo database, including TLS settings |
| `PAYLOAD_SECRET` | A fresh random secret; do not reuse the development secret |
| `SERVER_URL` | The final HTTPS origin, without a path, query string or trailing route |
| `R2_BUCKET` | Private bucket name |
| `R2_ENDPOINT` | The HTTPS S3 API origin supplied by Cloudflare |
| `R2_ACCESS_KEY_ID` | Bucket-scoped S3 access key |
| `R2_SECRET_ACCESS_KEY` | Corresponding secret key |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` on Vercel, to use the exact pnpm version in `packageManager` |
| `OPENROUTER_API_KEY` | Optional server secret enabling the AI field assistant; keep out of client bundles |
| `OPENROUTER_MODEL` | Optional free model slug (`:free`); empty uses `openrouter/free`; paid models are rejected |

Keep all credentials in the provider's environment settings, never in Git or
`vercel.json`. Build and runtime need the same application variables. Preview
deployments should use their own database, credentials and origin; do not share
production credentials with arbitrary preview branches.

The AI assistant is included in the published application. Its Production key is
stored as a Vercel secret and the configured model is `openrouter/free`. Only the
two AI variables were added for this release; database, R2 and origin settings
were preserved. Vercel performed the production build; no local build or database
migration was needed. Missing AI settings do not prevent catalog/login operation.
The per-process AI request guard is not a shared Vercel quota; use OpenRouter key
limits to control total usage. See the README for failure handling and AI checks.

The application requires an explicit `SERVER_URL` in production. It rejects
external HTTP origins. HTTPS enables the authentication cookie's `Secure` flag;
`HttpOnly` and `SameSite=Lax` protect the session cookie. HTTP loopback origins are
allowed for local production checks. CORS and CSRF use the configured origin.

## First deployment

1. Create a dedicated empty managed PostgreSQL database. Keep its connection
   string separate from the development environment.
2. Install the pinned Node.js / pnpm versions and run `pnpm install --frozen-lockfile`.
3. In a trusted local terminal or deployment job, select the new database and all
   required environment variables. Run `pnpm migrate`, then `pnpm migrate:status`.
   Apply existing migrations; do not generate new ones or enable schema push.
4. Before exposing a new empty database publicly, start the application locally
   against it and create its first employee. Explicitly select **Role → Admin**.
   Shut down the local process after initial setup. The public first-register
   endpoint must then return `403`.
5. Populate the database with the demo CLI if desired. It intentionally requires
   a local `SERVER_URL` and a non-production CLI process; use the same target
   database and R2 credentials, not the development database by accident. Keep
   its ignored `.libdesk-demo` ownership journal for later maintenance.
6. Link the GitHub repository to the hosting project or deploy with Vercel CLI.
   Use the Next.js preset, Node.js 24.x and the pinned pnpm version. Configure the
   final HTTPS `SERVER_URL` before building. The standard commands are `pnpm build`
   and, for a conventional Node.js host, `pnpm start`.
7. Build and runtime never apply database migrations automatically. Subsequent
   releases must apply any new migrations as an explicit controlled step.

## Public smoke check

- The HTTPS `/admin/login` page loads, including its JavaScript and CSS assets.
- Admin and Librarian can sign in; their controls and permissions differ.
- Anonymous collection requests and a copied private photo URL are rejected.
- Session cookies include `Secure`, `HttpOnly` and `SameSite=Lax` over HTTPS.
- Search a book by inventory number; edit its author inline.
- Open a reader, edit an active loan's due date inline, then return it from Loans.
- Upload and read a small permitted image. Verify an oversized/invalid upload is
  rejected and no local-disk fallback is used.
- Initial registration is closed. Provide reviewer credentials privately, outside
  the public repository. Tests and reset commands must not target the live app.

## Operational limits

PostgreSQL and R2 do not share a transaction. Failed uploads attempt compensation,
but a process crash or partial network/storage failure can leave orphaned objects
or a record whose files need repair. There is no background reconciliation job.
Do not treat rollback of the database as rollback of object storage.

Outbound email is not configured. Employee password changes work, but password
reset email delivery is not a completed feature. An administrator manages staff
accounts. Backups, monitoring, email delivery and object reconciliation are future
production work rather than features of this take-home demo.

References: [Vercel package managers](https://vercel.com/docs/package-managers),
[Payload S3 adapter](https://payloadcms.com/docs/upload/storage-adapters),
[Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/get-started/s3/).
