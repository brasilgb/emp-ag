CREATE TABLE "agent_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"event_version" integer NOT NULL,
	"source" varchar(100),
	"aggregate_type" varchar(50),
	"aggregate_id" varchar(50),
	"payload" jsonb NOT NULL,
	"idempotency_key" varchar(150),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_event_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"event_type" varchar(100) NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"job_id" integer NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_event_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"rule_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"job_run_id" integer,
	"status" varchar(20) DEFAULT 'matched' NOT NULL,
	"error_code" varchar(50),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_event_rules" ADD CONSTRAINT "agent_event_rules_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_rules" ADD CONSTRAINT "agent_event_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_deliveries" ADD CONSTRAINT "agent_event_deliveries_event_id_agent_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."agent_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_deliveries" ADD CONSTRAINT "agent_event_deliveries_rule_id_agent_event_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."agent_event_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_deliveries" ADD CONSTRAINT "agent_event_deliveries_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_deliveries" ADD CONSTRAINT "agent_event_deliveries_job_run_id_agent_job_runs_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."agent_job_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_status_idx" ON "agent_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_events_event_type_idx" ON "agent_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "agent_events_received_at_idx" ON "agent_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "agent_events_aggregate_idx" ON "agent_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_events_idempotency_idx" ON "agent_events" USING btree ("idempotency_key") WHERE "agent_events"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_event_rules_event_type_idx" ON "agent_event_rules" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "agent_event_rules_job_id_idx" ON "agent_event_rules" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "agent_event_rules_enabled_idx" ON "agent_event_rules" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_event_deliveries_event_rule_idx" ON "agent_event_deliveries" USING btree ("event_id","rule_id");--> statement-breakpoint
CREATE INDEX "agent_event_deliveries_job_run_id_idx" ON "agent_event_deliveries" USING btree ("job_run_id");--> statement-breakpoint
CREATE INDEX "agent_event_deliveries_status_idx" ON "agent_event_deliveries" USING btree ("status");