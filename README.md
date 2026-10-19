# LibDesk

LibDesk is an internal library desk for a catalog of physical books, reader cards,
and lending history. Staff use the standard Payload admin to search the catalog,
manage photographs, issue books, change due dates, and record returns.

Each **Book is one physical copy** with its own unique inventory number. Copies
may share a title and ISBN. Authors are shared between books; Members are reader
cards, **not login accounts**. Employees are the accounts used to sign in.

The application includes server-enforced Admin and Librarian permissions, private
image uploads, search and filters, two inline editing scenarios, reproducible demo
data, and an optional AI helper for explaining form fields. It is one Next.js /
TypeScript / Payload application with PostgreSQL and Cloudflare R2; there is no
separate backend to start.

## Run your own local instance

Follow these steps in order. You need **your own PostgreSQL database, private R2
bucket, and employee accounts**. Cloning the repository creates none of them.
No shared email/password or private file from the author is needed.

### 1. Install tools and download the source

Use **Node.js 24.21.0** and **pnpm 11.25.0**, pinned in `.nvmrc` and the
`packageManager` field of `package.json`. The locked application versions include
Payload **3.90.2**, Next.js **16.4.0**, React **19.3.0**, and TypeScript **5.7.3**.
You also need Git and a browser, plus network access to the package registry,
PostgreSQL, and R2.

If Node.js is not installed, get the installer or archive for your operating
system and architecture from the official [Node.js 24.21.0 release directory](https://nodejs.org/download/release/v24.21.0/).
The installer includes npm. Open a new terminal after installation and check:

```sh
node --version
npm --version
npm install --global pnpm@11.25.0
pnpm --version
```

The expected Node and pnpm outputs are `v24.21.0` and `11.25.0`. Install the
explicit pnpm version above: the latest version in the [pnpm installation guide](https://pnpm.io/installation)
may differ from the project's pin. Corepack is not required for this route.
If a Corepack shim is already managing pnpm, use `corepack enable` and
`corepack install --global pnpm@11.25.0` instead of the global npm installation;
see the official [Corepack commands](https://github.com/nodejs/corepack#utility-commands).

Alternatively, on macOS/Linux, first install nvm using its official
[installation instructions](https://github.com/nvm-sh/nvm#installing-and-updating),
restart the terminal, then run `nvm install 24.21.0`, `nvm use 24.21.0`, and
`npm install --global pnpm@11.25.0`. This also avoids system-wide npm permission
errors. nvm and Corepack are alternatives, not prerequisites already assumed to
be present.

Download the actual repository and install exactly the locked dependencies:

```sh
git clone https://github.com/OlegPeunov/libdesk.git
cd libdesk
pnpm install --frozen-lockfile
```

Run the remaining commands from this `libdesk` directory. Do not regenerate the
lockfile or upgrade dependencies to complete the walkthrough.

### 2. Prepare your cloud resources

**PostgreSQL:** create a dedicated, empty development database. Do not use a
production database or one containing another application's tables.

For example, create a project in [Neon](https://neon.com/docs/manage/projects),
then create/select your empty database under the project's branch. In **Connect**,
select the correct branch, database, and database role, and copy its PostgreSQL
connection string. For this local walkthrough, choose a **direct connection**
(disable connection pooling): the maintenance script uses a session advisory
lock. Keep the supplied TLS options. Use the database owner or a role permitted
to create tables, types, indexes, and constraints in the `public` schema.
See [Neon database management](https://neon.com/docs/manage/databases) and
[connecting an application](https://neon.com/docs/connect/connect-from-any-app).
Other PostgreSQL providers also work if they provide equivalent access.

**Cloudflare R2:** enable R2 in your own Cloudflare account if necessary, then
create a dedicated bucket in **R2 Object Storage**. Leave it private: do not
connect a public custom domain or enable the public `r2.dev` URL. See the official
[bucket creation guide](https://developers.cloudflare.com/r2/buckets/create-buckets/).

In R2 **Account Details → API Tokens → Manage**, create an R2 API token with
**Object Read & Write**, restricted to your bucket. Copy its **Access Key ID** and
**Secret Access Key** when shown; the secret is not displayed again. These are
S3 credentials, not the Cloudflare global API key or the token's raw value. The
application needs object listing, reading, uploading, and deletion permissions;
it does not need bucket administration permissions.

Copy the bucket's **S3 API endpoint** from Cloudflare. Its usual form is
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; jurisdiction-specific buckets
need the corresponding endpoint shown by Cloudflare. Do not append the bucket
name. Follow the official [R2 authentication guide](https://developers.cloudflare.com/r2/api/tokens/).
Uploads and downloads pass through the Node.js application, so this setup does
not require public bucket access or browser-to-R2 upload configuration.

### 3. Configure the local environment

In your new checkout:

```sh
cp .env.example .env
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

Copy the generated random value into `PAYLOAD_SECRET`, then fill the other
required values in `.env`. This command generates a secret for your instance;
do not use an example value. Keep it stable between restarts.

| Variable | Required? | Purpose, source, and format |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Your database provider's PostgreSQL connection string, e.g. `postgresql://YOUR_ROLE:YOUR_PASSWORD@db.example.invalid/YOUR_DATABASE?sslmode=require`. Preserve the real provider's TLS parameters and URL-encoded password. |
| `PAYLOAD_SECRET` | Yes | The random 64-character hexadecimal value generated above. Used by Payload for authentication/token security. |
| `SERVER_URL` | Set for this walkthrough | Exact browser origin: `http://localhost:3000`. No `/admin`, path, query, or credentials. It also configures allowed CORS/CSRF origins and secure-cookie behavior. |
| `R2_BUCKET` | Yes | The name of your private bucket, e.g. `my-libdesk-images`. |
| `R2_ENDPOINT` | Yes | Your HTTPS S3 service origin, e.g. `https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com`; use the jurisdiction-specific origin if applicable. No bucket path or public domain. |
| `R2_ACCESS_KEY_ID` | Yes | Access Key ID issued for your bucket-scoped R2 S3 credentials. |
| `R2_SECRET_ACCESS_KEY` | Yes | Matching Secret Access Key issued with that ID. |
| `OPENROUTER_API_KEY` | No | Your own OpenRouter API key for the optional field assistant; leave empty to skip AI setup. |
| `OPENROUTER_MODEL` | No | `openrouter/free` if empty, or an available explicit model ID ending in `:free`. See the AI section below. |

All connection strings and identifiers above are illustrative placeholders, not
working service credentials. A PostgreSQL URL starts with `postgresql://` or
`postgres://`; it is not a Neon dashboard URL. The R2 endpoint is an S3 service
URL; it is not a photograph's URL.

**Complete PostgreSQL and R2 configuration before `pnpm migrate`.** The Payload
configuration requires the R2 variables even for migration commands. LibDesk does
not provision a cloud database or bucket, and has no SQLite or local upload
fallback. `.env` is ignored by Git; only the empty `.env.example` template belongs
in the repository. Never put secrets in `NEXT_PUBLIC_` variables.

### 4. Apply existing migrations and start the application

In **terminal 1**, from the project directory:

```sh
pnpm migrate
pnpm migrate:status
pnpm dev
```

All six existing migrations should show as applied in the status output. You do
not need to create a migration for installation. Automatic database schema push
and automatic database creation are disabled.

Leave terminal 1 running while you use the application. Once Next.js is ready,
open [http://localhost:3000/admin](http://localhost:3000/admin). Use this exact
host and port, matching `SERVER_URL`. Stopping the terminal stops the local app;
it does not remove database records or R2 files.

### 5. Create your first Admin

On your **empty, migrated database**, `/admin` opens Payload's native first-user
form. Enter your own name, email, and a strong password, and **explicitly choose
Role → Admin** before submitting. The default role is **Librarian**. No employee
or password is installed by cloning the code or applying migrations.

After the first employee is created, public initial registration closes. The
first account can now manage staff through **Employees**. New employees default
to Librarian; an Admin can explicitly select Admin for another employee.

If you see the ordinary login form, your connected database already has an
employee. Sign in with an account you created for that database, or connect your
intended empty database and apply migrations there. **Logging out does not make
a database empty.** Do not try credentials belonging to a different installation.
If you accidentally made the only employee a Librarian, this application has no
self-service role promotion: for a disposable fresh installation, start again
with a new empty database and explicitly select Admin. Do not reset a database
containing data you need. Password-reset email delivery is not configured.

### 6. Add and check demo data

Keep the dev server in terminal 1 running. Open **terminal 2**, change to the same
project directory, and run these commands after creating the Admin:

```sh
cd /path/to/your/libdesk
pnpm seed
pnpm seed:check
```

Replace the path with your actual checkout path. Wait for each command to finish.
The seed uses the existing Admin for normal, access-checked operations; it does
not create employees, choose passwords, or change staff accounts.

The default namespace is `v1`. The initial fictional dataset contains:

| Data | Count |
| --- | ---: |
| Authors | 30 |
| Physical book copies | 150: 30 editions, five copies per edition |
| Reader cards | 80 |
| Loans | 300: initially 240 returned, 60 active, including 30 overdue |
| Distinct cover images | 12, shared by 60 copies |

There are books with several authors and books without photographs. Covers are
generated in memory and uploaded through Media; each has an original and a
thumbnail, for **24 R2 objects**. `seed:check` verifies counts, relationships,
unique identifiers, dates, the active-loan index, stored files, and preservation
of records outside the demo set. It prints a `PASS` summary on success.

With the same environment and ownership journal, repeating `pnpm seed` reuses the
set without duplicates and preserves demo edits. Dates are relative to the
**first** seed run; repeating it does not move due dates forward. Overdue counts
can therefore change over time or after manual returns.

Keep the ignored `.libdesk-demo/v1.json` ownership journal. It ties exact record
IDs and object keys to this database and bucket. A new checkout without that
journal cannot adopt an existing demo set merely from similar names; ambiguous
ownership is deliberately rejected. Do not delete the journal to retry a failed
seed. See the separate reset section for intentional cleanup.

### 7. Explore the application and compare roles

Some custom controls and validation messages are in Russian; standard Payload
controls use English.

1. Open **Books** and search for `LD-DEMO-v1-B001` or part of a title. Use
   **Filters** to narrow the list by title, inventory number, or authors. Open a
   copy with a photograph and verify its image appears. Several copies can have
   the same title/ISBN, but not the same inventory number.
2. In that saved Book, find **Авторы: редактирование на странице** (inline authors).
   Edit an author's name and click **Сохранить автора**. This updates the shared
   Author for every related book, independently of the Book's Save button.
   Preserve the `[DEMO:v1:…]` prefix if editing a demo author. The block shows
   saved relationships; changing the Authors selector requires saving the Book
   before the block uses the new selection. A new Book must first be saved.
3. Open **Members**, search by name, card number, or email, and use Filters to
   narrow the list. Create a reader with your own unique card number. Members
   have no password or login. A duplicate card number is rejected.
4. For a lending exercise, create a separate Book with your own unique inventory
   number (rather than borrowing a seeded copy). This keeps the tracked demo set
   independent of your new records. Optionally upload a JPEG, PNG, or WebP in
   Photo, or select existing Media.
5. In **Loans**, create a loan linking that Book and your new Member. Keep the
   default issue time and choose a due date strictly later than it. A second
   active loan for the same copy is rejected, including concurrent requests.
6. Open the saved Member. **Выдачи читателя** shows paginated history. Change the
   active row's due date and click **Сохранить срок**. Only that field is sent;
   the parent Member form is not saved. Try a due date before issuance: the
   server rejects it and the entered value remains available for correction.
   Use **Открыть выдачу** to open the complete loan record.
7. In the Loan record, click **Вернуть книгу** (Return book). It sets the return
   time once and preserves the loan in history. Closed loans cannot be edited,
   reopened, or deleted. A later lending of the same copy is a new Loan. In the
   list, try **Активные** (active), **Возвращённые** (returned), and
   **Просроченные** (overdue). Overdue means `dueAt < now` with no `returnedAt`;
   no separate status is stored.
8. As Admin, open **Employees → Create New**, enter another name, email, and
   password of your choosing, and leave Role at **Librarian**. Save. Log out at
   `/admin/logout`, then sign in with that employee. Catalog maintenance and
   lending remain available; catalog Delete and employee management are absent.
   Use the account control to edit your own name/password. Log out and sign back
   in as your Admin to compare. You can create another Admin through Employees
   by explicitly selecting that role.

## Permissions and data rules

| Action | Admin | Librarian |
| --- | --- | --- |
| Read/create/update authors, books, members, and Media | Yes | Yes |
| Issue, change the due date of, and return active loans | Yes | Yes |
| Delete catalog records and unused Media | Yes, subject to history/usage rules | No |
| Create employees and manage another employee's account/role | Yes | No |
| View/change own name and password | Yes | Yes |
| Change own role or delete own account | No | No |
| Edit a closed loan, reopen it, or delete loan history | No | No |

Anonymous users cannot read application records or private files. Restrictions
apply to server operations, including REST and Local API with access checks, as
well as admin actions. Librarians cannot access another employee's account or
change their own role. Payload handles password hashing and authentication;
sessions use HttpOnly, SameSite=Lax cookies and Secure cookies on HTTPS.

Loan Book, Member, and issue date become immutable after creation. Due date must
be later than issue date; return date cannot be earlier. A PostgreSQL partial
unique index prevents two active loans for one copy. Books and Members with loan
history cannot be deleted by either role. An Author is a shared catalog record.

Uploads must decode as JPEG, PNG, or WebP, match their declared type, be at most
**3 MiB**, at most **4096 pixels per side**, and at most **16 megapixels**; animated
images are rejected. Originals and thumbnails are stored privately in R2,
processed in memory, and served through Payload authorization with private,
non-shared-cache responses. Deleting a Book or unlinking its Photo does not delete
the shared file. A photo linked to any Book cannot be deleted from Media.

## Optional: AI field explanations

The core application and seed work without an AI key. To enable the existing
helper, create your own key through [OpenRouter](https://openrouter.ai/docs/quickstart),
set `OPENROUTER_API_KEY` in your local `.env`, and restart the local server.
Optionally set `OPENROUTER_MODEL`: empty means `openrouter/free`; a specific
available `:free` model can be pinned. Paid model IDs are rejected. Requests set
zero maximum provider prices and disable provider fallback; no translation call
or second model is used. See the [free router documentation](https://openrouter.ai/docs/cookbook/get-started/free-models-router-playground).

In an Author, Book, Member, Loan, or Media form, open **AI-помощник по полям**,
choose a field, and ask a short question. It should explain the actual field and
rules in Russian with a fictional example, or decline unrelated questions. The
helper sends field definitions/help text and your question, not current card
values, reader/staff records, photographs, passwords, or secrets. Do not type
personal information into a question. It neither changes nor saves the form.

Requests require an employee session and the configured origin, allow up to
1000 question characters / a 4 KiB request, and time out after 25 seconds.
Missing keys, unavailable models, provider errors, limits, and rejected responses
show an error while retaining the question. The per-process limit is five
requests/minute and one concurrent request per employee; it is not a shared
quota across multiple deployment instances.

**Verification status, 2026-10-19:** focused AI checks and local authorization /
CSRF checks passed in the preceding AI task. Of three real free-provider calls,
the photo and due-date questions both returned 429, so successful explanations
for those two cases remain **unconfirmed**. The unrelated question received a
correct Russian refusal. The free Gemma endpoint tested was not retained as a
verified model; the configured default remains `openrouter/free`. No real AI
requests are needed for installation, and none were made for this README check.

Free models have variable availability, latency, rate limits, and answer quality.
The mixed-script response filter rejects predominantly foreign prose and known
service strings, but is a **script heuristic, not Russian language detection**:
it can reject valid foreign names, accept another Cyrillic language, or miss a
factual error. Technical terms such as ISBN/JPEG, field names, numbers, and dates
are allowed. Server validation and field descriptions remain authoritative.
These local source quality corrections have not been deployed to the hosted demo.

## Optional: reset only the tracked demo set

Reset is not an installation step. Use it only with the original matching
`.libdesk-demo/<namespace>.json` journal, its database and bucket, and deliberate
confirmation. Default namespace:

```sh
pnpm seed:reset -- --confirm
```

For a separate namespace, use the same argument for every command:

```sh
pnpm seed -- --namespace=my-review
pnpm seed:check -- --namespace=my-review
pnpm seed:reset -- --namespace=my-review --confirm
```

Namespaces contain 1–24 lowercase letters, digits, or hyphens. Maintenance is
restricted to a non-production environment with a loopback `SERVER_URL`; run
one maintenance command at a time. The CLI checks exact IDs, creation times,
markers, relationships, and object ownership. If the journal is missing, markers
were changed, or outside records reference demo records/photos, it refuses
ambiguous cleanup. Do not manually remove safeguards or edit the journal to
force deletion. Keep manual tour records independent of the demo set.

Normal application operations always prohibit deleting loan history. Reset uses
a separate, privileged **CLI-only** maintenance transaction to remove the
journaled loans before their catalog records, then removes the owned Media and
R2 files. It has no public endpoint or bypass flag in working hooks, does not
disable database constraints, never clears the whole database/bucket, and does
not delete employees or unowned records. Interrupted cleanup should be resumed
with the same journal and explicit reset command.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `pnpm` is not found, or the version differs | Reopen the terminal after installing tools; follow step 1 and check `node --version` / `pnpm --version`. Run scripts with `pnpm dev`; `npm dev` is not an npm command. |
| `Set DATABASE_URL`, `PAYLOAD_SECRET`, or `R2_…` | Run from the project directory; ensure `.env` exists there and contains non-empty required variables. R2 configuration is loaded even by migration commands. Restart after environment changes. |
| Database connection/authentication/TLS failure | Check the selected database, role, URL-encoded password, network access, and provider TLS parameters. Wake a suspended provider if needed. Use a direct connection for this walkthrough; do not disable TLS to silence an error. |
| Missing relation/column/type on startup | Run `pnpm migrate`, then `pnpm migrate:status`, against the same `.env` as the server. Do not enable automatic schema push or invent a fresh migration for installation. |
| R2 `AccessDenied`, missing bucket, or storage-unavailable error | Check bucket name, matching S3 key pair, Object Read & Write scope (including object deletion), endpoint/jurisdiction, and connectivity. Object credentials need not be able to create buckets: create your bucket in the dashboard first. There is no local-file fallback. |
| Login appears instead of the first-user form | An employee already exists in that database. Logout does not delete employees. Use your own account for that database, or an actual new empty database if starting over. Seed does not install a login. |
| Login/inline/AI requests fail after changing the address | Match `SERVER_URL` exactly to the browser origin, including scheme, host, and port. Do not mix `localhost` and `127.0.0.1`, or set HTTPS while browsing HTTP. Restart the server after correcting `.env`. |
| Port 3000 is occupied | Leave the other app running if it is needed. Set your `.env` to `SERVER_URL=http://localhost:3100`, start `pnpm dev --port 3100`, and use `http://localhost:3100/admin`. Use a free port and the same origin throughout. |
| Seed asks for an Admin | Create the first employee and explicitly select Admin before seeding. Employees and Members are different collections. |
| Seed/reset reports ownership ambiguity | Keep the original journal and environment together. Do not delete someone else's records or guess ownership from a prefix. Use fresh isolated resources for a fresh walkthrough. |
| AI returns an error or says it is not configured | AI is optional. Supply your own key and restart to enable it; a free provider may return 429 or be unavailable. Core catalog and lending operations remain usable. |

## Fresh-setup verification

On **2026-10-19**, a source-only copy of the prepared working tree was made
without an existing `.env`, `node_modules`, build output, private access files,
or seed journals. The following were actually run, rather than inferred from
reading the code:

- `pnpm install --frozen-lockfile` with Node.js 24.21.0 / pnpm 11.25.0: passed.
- A separate PostgreSQL database was created and confirmed to contain no public
  tables; `pnpm migrate` applied all six migrations and `pnpm migrate:status`
  showed all six as applied.
- `pnpm dev --port 3107`, with the same port in `SERVER_URL`: started. The native
  first-user form created an Admin after explicitly selecting that role.
- `pnpm seed`: created 572 records: 30 authors, 150 books, 80 members, 300 loans,
  and 12 Media records. The 12 covers and their thumbnails produced 24 objects
  in a separate private R2 bucket. There were 240 returned, 60 active, and
  30 overdue loans; 60 books had photos and 40 had multiple authors.
- `pnpm seed:check`: passed the counts, relationships, dates, active-loan
  uniqueness/index, R2 file, and non-demo preservation checks. A second
  `pnpm seed` created **0 records** and reused all 572, with unchanged counts.
- Browser checks confirmed searching for `LD-DEMO-v1-B001`, its displayed cover,
  and the Loans overdue filter showing 30 results.
- That Admin created a Librarian through Employees, keeping the default role.
  Browser login succeeded for both accounts; Employees appeared only for Admin.
  Anonymous first registration and a request to a photo's file URL returned
  HTTP 403.
- `pnpm seed:reset -- --confirm`: removed only the journaled test set and its
  R2 objects, preserving the temporary employee records and passwords.

The verification session was interrupted after seeding. Before resuming browser
login checks, only the two disposable fixture passwords in the isolated database
were regenerated using access-checked Payload operations. This was test-fixture
maintenance, not an installation step, custom registration, or bootstrap feature.
No application code fix was needed.

Full test suites, production builds, and real AI requests were not run for this
documentation task. The existing development environment and hosted demo were
not changed. After reset, an additional check confirmed zero remaining demo
records, unchanged temporary employees/password hashes, and the R2 bucket restored
to its empty baseline. The temporary server, test database (including both test
employees), source copy, and generated credential files were then removed.
The supplied test bucket was retained, empty; its local credentials stayed
unchanged and excluded from Git. Another reviewer needs their own resources,
not this verification environment.

## Development checks and production mode

These commands already exist; they are not required to finish the local tour:

```sh
pnpm check                 # configuration tests + TypeScript
pnpm test:ai               # focused AI unit checks, mocked provider
pnpm test:ai:integration   # local auth/CSRF checks, no real inference by default
pnpm test:loans
pnpm test:access
pnpm test:media
pnpm test:media:unavailable
pnpm test:inline
```

Integration suites require a local server and matching PostgreSQL/R2 settings.
Use disposable resources, run suites sequentially, and keep them away from the
hosted demo. They create and remove their own scoped fixtures. The full `pnpm test`
script combines the suites; it is not a prerequisite for installing the app.

For a local production-mode run, first stop your dev server on that port, keep
`SERVER_URL` matched to the address you will open, then run:

```sh
pnpm build
pnpm start
```

Keep the `start` terminal running. Production requires an explicit `SERVER_URL`;
use an HTTPS origin for an actual public deployment. Database and object storage
are still external, and migrations are applied separately. This section is a
local mode switch, not an automatic deployment command.

## Hosted demo and project scope

An independently hosted example is at [https://libdesk.vercel.app/admin](https://libdesk.vercel.app/admin).
It has its own database, files, and employee accounts. Accounts you create locally
do not sign in there, and no hosted credentials are bundled with the source.
The complete local walkthrough above does not depend on access to that demo.
The hosted version may lag this source, including AI response
quality corrections. Nothing in this setup process publishes an application.

Payload supplies authentication, forms, lists, and REST operations in the same
Next.js app. PostgreSQL supports relational history and database-enforced loan
uniqueness. R2 keeps uploads outside the server filesystem. GraphQL is disabled.
Deliberate omissions include public reader accounts, OAuth, reservations, fines,
and notifications. Password-reset emails are not configured. PostgreSQL and R2
have no shared transaction or background reconciliation, so crashes during file
operations can require manual repair. AI is an optional bonus, not a validator.

Further context: [requirement mapping](docs/requirements.md),
[deployment notes](docs/deployment.md), and [additional reviewer examples](docs/reviewer-guide.md).
These are supplementary; no private access file is needed for local setup.
