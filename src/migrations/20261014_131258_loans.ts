import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "loans" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"book_id" integer NOT NULL,
  	"member_id" integer NOT NULL,
  	"issued_at" timestamp(3) with time zone NOT NULL,
  	"due_at" timestamp(3) with time zone NOT NULL,
  	"returned_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "loans_id" integer;
  ALTER TABLE "loans" ADD CONSTRAINT "loans_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE restrict ON UPDATE no action;
  ALTER TABLE "loans" ADD CONSTRAINT "loans_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;
  CREATE INDEX "loans_book_idx" ON "loans" USING btree ("book_id");
  CREATE INDEX "loans_member_idx" ON "loans" USING btree ("member_id");
  CREATE INDEX "loans_due_at_idx" ON "loans" USING btree ("due_at");
  CREATE INDEX "loans_returned_at_idx" ON "loans" USING btree ("returned_at");
  CREATE INDEX "loans_updated_at_idx" ON "loans" USING btree ("updated_at");
  CREATE INDEX "loans_created_at_idx" ON "loans" USING btree ("created_at");
  CREATE UNIQUE INDEX "loans_one_active_book_idx" ON "loans" USING btree ("book_id") WHERE "loans"."returned_at" IS NULL;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_loans_fk" FOREIGN KEY ("loans_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_loans_id_idx" ON "payload_locked_documents_rels" USING btree ("loans_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "loans" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_loans_fk";
  DROP TABLE "loans" CASCADE;
  
  DROP INDEX "payload_locked_documents_rels_loans_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "loans_id";`)
}
