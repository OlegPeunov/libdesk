# Deploying LibDesk

LibDesk runs as one Next.js / Payload application on Node.js, with managed PostgreSQL
and a private Cloudflare R2 bucket. `vercel.json` selects Frankfurt (`fra1`) to keep
the application near the Neon database. No paid hosting upgrade is required by the
application itself.

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

Keep all credentials in the provider's environment settings, never in Git or
`vercel.json`. Build and runtime need the same application variables. Preview
deployments should use their own database, credentials and origin; do not share
production credentials with arbitrary preview branches.

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
