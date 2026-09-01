CREATE TABLE "agent_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"objective" text NOT NULL,
	"agent_id" integer NOT NULL,
	"created_by" integer NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"trigger_type" varchar(20) NOT NULL,
	"schedule_config" jsonb,
	"event_config" jsonb,
	"max_runs_per_day" integer DEFAULT 24 NOT NULL,
	"max_actions_per_run" integer DEFAULT 10 NOT NULL,
	"max_open_approvals" integer DEFAULT 10 NOT NULL,
	"timeout_seconds" integer DEFAULT 60 NOT NULL,
	"shadow_mode" boolean DEFAULT false NOT NULL,
	"allow_concurrent_runs" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"trigger_type" varchar(20) NOT NULL,
	"trigger_payload" jsonb,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"action_plan_id" integer,
	"error_code" varchar(50),
	"error_message" text,
	"idempotency_key" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_delegations" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_agent_id" integer NOT NULL,
	"target_agent_id" integer NOT NULL,
	"job_run_id" integer,
	"objective" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_action_plans" ADD COLUMN "job_run_id" integer;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD CONSTRAINT "agent_job_runs_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD CONSTRAINT "agent_job_runs_action_plan_id_agent_action_plans_id_fk" FOREIGN KEY ("action_plan_id") REFERENCES "public"."agent_action_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_target_agent_id_agents_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_job_run_id_agent_job_runs_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."agent_job_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_jobs_status_idx" ON "agent_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_jobs_trigger_type_idx" ON "agent_jobs" USING btree ("trigger_type");--> statement-breakpoint
CREATE INDEX "agent_jobs_next_run_at_idx" ON "agent_jobs" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "agent_jobs_agent_id_idx" ON "agent_jobs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_jobs_created_by_idx" ON "agent_jobs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "agent_job_runs_job_id_idx" ON "agent_job_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "agent_job_runs_status_idx" ON "agent_job_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_job_runs_created_at_idx" ON "agent_job_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_runs_action_plan_id_idx" ON "agent_job_runs" USING btree ("action_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_runs_idempotency_idx" ON "agent_job_runs" USING btree ("job_id","idempotency_key") WHERE "agent_job_runs"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_delegations_job_run_id_idx" ON "agent_delegations" USING btree ("job_run_id");--> statement-breakpoint
CREATE INDEX "agent_delegations_target_agent_id_idx" ON "agent_delegations" USING btree ("target_agent_id");--> statement-breakpoint
ALTER TABLE "agent_action_plans" ADD CONSTRAINT "agent_action_plans_job_run_id_agent_job_runs_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."agent_job_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_action_plans_job_run_id_idx" ON "agent_action_plans" USING btree ("job_run_id");--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_exactly_one_target" CHECK (("agent_approvals"."execution_id" IS NOT NULL AND "agent_approvals"."plan_item_id" IS NULL) OR ("agent_approvals"."execution_id" IS NULL AND "agent_approvals"."plan_item_id" IS NOT NULL));