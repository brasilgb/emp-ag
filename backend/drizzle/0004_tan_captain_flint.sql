CREATE TABLE "financial_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"type" varchar(20) NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "financial_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(20) NOT NULL,
	"category_id" integer NOT NULL,
	"client_id" integer,
	"project_id" integer,
	"description" varchar(255) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"paid_at" timestamp with time zone,
	"competence_date" date NOT NULL,
	"payment_method" varchar(20),
	"reference" varchar(120),
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_entries_amount_positive" CHECK ("financial_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "financial_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_method" varchar(20),
	"reference" varchar(120),
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_payments_amount_positive" CHECK ("financial_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_category_id_financial_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."financial_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_payments" ADD CONSTRAINT "financial_payments_entry_id_financial_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."financial_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_payments" ADD CONSTRAINT "financial_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_categories_type_idx" ON "financial_categories" USING btree ("type");--> statement-breakpoint
CREATE INDEX "financial_categories_is_active_idx" ON "financial_categories" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "financial_entries_type_idx" ON "financial_entries" USING btree ("type");--> statement-breakpoint
CREATE INDEX "financial_entries_status_idx" ON "financial_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "financial_entries_due_date_idx" ON "financial_entries" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "financial_entries_competence_date_idx" ON "financial_entries" USING btree ("competence_date");--> statement-breakpoint
CREATE INDEX "financial_entries_client_id_idx" ON "financial_entries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "financial_entries_project_id_idx" ON "financial_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "financial_entries_category_id_idx" ON "financial_entries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "financial_payments_entry_id_idx" ON "financial_payments" USING btree ("entry_id");