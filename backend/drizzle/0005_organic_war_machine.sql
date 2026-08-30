CREATE TABLE "support_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"description" text,
	"default_priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "support_sla_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"priority" varchar(20) NOT NULL,
	"first_response_minutes" integer NOT NULL,
	"resolution_minutes" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_sla_policies_priority_unique" UNIQUE("priority")
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"project_id" integer,
	"category_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"owner_user_id" integer,
	"opened_by_user_id" integer NOT NULL,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"resolution" text,
	"sla_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"user_id" integer,
	"type" varchar(20) DEFAULT 'message' NOT NULL,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"actor_type" varchar(30) NOT NULL,
	"actor_id" varchar(100),
	"event" varchar(50) NOT NULL,
	"old_data" jsonb,
	"new_data" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_success_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"owner_user_id" integer,
	"status" varchar(20) DEFAULT 'onboarding' NOT NULL,
	"health_score" integer DEFAULT 50 NOT NULL,
	"onboarding_status" varchar(20) DEFAULT 'not_started' NOT NULL,
	"last_contact_at" timestamp with time zone,
	"next_contact_at" timestamp with time zone,
	"satisfaction_score" integer,
	"churn_risk" varchar(20) DEFAULT 'low' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_success_accounts_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "customer_success_accounts_health_score_range" CHECK ("customer_success_accounts"."health_score" >= 0 AND "customer_success_accounts"."health_score" <= 100),
	CONSTRAINT "customer_success_accounts_satisfaction_score_range" CHECK ("customer_success_accounts"."satisfaction_score" IS NULL OR ("customer_success_accounts"."satisfaction_score" >= 1 AND "customer_success_accounts"."satisfaction_score" <= 5))
);
--> statement-breakpoint
CREATE TABLE "customer_success_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"cs_account_id" integer NOT NULL,
	"user_id" integer,
	"type" varchar(30) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_success_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"cs_account_id" integer,
	"type" varchar(20) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"estimated_value" numeric(14, 2),
	"status" varchar(20) DEFAULT 'identified' NOT NULL,
	"owner_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_success_opportunities_estimated_value_positive" CHECK ("customer_success_opportunities"."estimated_value" IS NULL OR "customer_success_opportunities"."estimated_value" > 0)
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_category_id_support_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."support_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_history" ADD CONSTRAINT "support_ticket_history_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_success_accounts" ADD CONSTRAINT "customer_success_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_success_accounts" ADD CONSTRAINT "customer_success_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_success_activities" ADD CONSTRAINT "customer_success_activities_cs_account_id_customer_success_accounts_id_fk" FOREIGN KEY ("cs_account_id") REFERENCES "public"."customer_success_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_success_activities" ADD CONSTRAINT "customer_success_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_success_opportunities" ADD CONSTRAINT "customer_success_opportunities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_success_opportunities" ADD CONSTRAINT "customer_success_opportunities_cs_account_id_customer_success_accounts_id_fk" FOREIGN KEY ("cs_account_id") REFERENCES "public"."customer_success_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_success_opportunities" ADD CONSTRAINT "customer_success_opportunities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_categories_is_active_idx" ON "support_categories" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "support_tickets_priority_idx" ON "support_tickets" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "support_tickets_client_id_idx" ON "support_tickets" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "support_tickets_project_id_idx" ON "support_tickets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "support_tickets_owner_user_id_idx" ON "support_tickets" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "support_tickets_sla_due_at_idx" ON "support_tickets" USING btree ("sla_due_at");--> statement-breakpoint
CREATE INDEX "support_tickets_category_id_idx" ON "support_tickets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "support_messages_ticket_id_idx" ON "support_messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_ticket_history_ticket_id_idx" ON "support_ticket_history" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_ticket_history_event_idx" ON "support_ticket_history" USING btree ("event");--> statement-breakpoint
CREATE INDEX "support_ticket_history_created_at_idx" ON "support_ticket_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customer_success_accounts_status_idx" ON "customer_success_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "customer_success_accounts_next_contact_at_idx" ON "customer_success_accounts" USING btree ("next_contact_at");--> statement-breakpoint
CREATE INDEX "customer_success_accounts_churn_risk_idx" ON "customer_success_accounts" USING btree ("churn_risk");--> statement-breakpoint
CREATE INDEX "customer_success_activities_cs_account_id_idx" ON "customer_success_activities" USING btree ("cs_account_id");--> statement-breakpoint
CREATE INDEX "customer_success_activities_occurred_at_idx" ON "customer_success_activities" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "customer_success_opportunities_client_id_idx" ON "customer_success_opportunities" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "customer_success_opportunities_cs_account_id_idx" ON "customer_success_opportunities" USING btree ("cs_account_id");--> statement-breakpoint
CREATE INDEX "customer_success_opportunities_status_idx" ON "customer_success_opportunities" USING btree ("status");