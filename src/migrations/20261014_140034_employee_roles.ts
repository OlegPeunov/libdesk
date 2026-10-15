import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   -- Preflight found exactly one existing employee: the owner's account, ID 1.
   -- Never promote arbitrary employees if that assumption changes before apply.
   LOCK TABLE "employees" IN ACCESS EXCLUSIVE MODE;
   DO $$
   BEGIN
     IF (SELECT count(*) FROM "employees") > 0 AND (
       (SELECT count(*) FROM "employees") <> 1 OR
       NOT EXISTS (SELECT 1 FROM "employees" WHERE "id" = 1)
     ) THEN
       RAISE EXCEPTION 'Cannot unambiguously identify the existing owner account. Roles migration aborted.';
     END IF;
   END $$;
   CREATE TYPE "public"."enum_employees_role" AS ENUM('admin', 'librarian');
   ALTER TABLE "employees" ADD COLUMN "role" "enum_employees_role" DEFAULT 'librarian' NOT NULL;
   UPDATE "employees" SET "role" = 'admin' WHERE "id" = 1;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "employees" DROP COLUMN "role";
  DROP TYPE "public"."enum_employees_role";`)
}
