CREATE TABLE "agent_autonomy_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"rule_id" integer,
	"event_id" integer,
	"trigger_type" varchar(20) NOT NULL,
	"reason" varchar(50) NOT NULL,
	"root_execution_id" integer,
	"causation_run_id" integer,
	"attempted_depth" integer NOT NULL,
	"limit_value" integer,
	"current_value" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "autonomy_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "circuit_state" varchar(20) DEFAULT 'closed' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "circuit_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "circuit_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "autonomy_rate_limit_override" integer;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "autonomy_rate_window_override_seconds" integer;--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD COLUMN "root_execution_id" integer;--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD COLUMN "causation_run_id" integer;--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD COLUMN "causation_event_delivery_id" integer;--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD COLUMN "autonomy_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN "caused_by_run_id" integer;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN "root_execution_id" integer;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN "autonomy_depth" integer;--> statement-breakpoint
ALTER TABLE "agent_autonomy_blocks" ADD CONSTRAINT "agent_autonomy_blocks_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_autonomy_blocks" ADD CONSTRAINT "agent_autonomy_blocks_rule_id_agent_event_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."agent_event_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_autonomy_blocks" ADD CONSTRAINT "agent_autonomy_blocks_event_id_agent_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."agent_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_autonomy_blocks_job_id_idx" ON "agent_autonomy_blocks" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "agent_autonomy_blocks_root_execution_id_idx" ON "agent_autonomy_blocks" USING btree ("root_execution_id");--> statement-breakpoint
CREATE INDEX "agent_autonomy_blocks_reason_idx" ON "agent_autonomy_blocks" USING btree ("reason");--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD CONSTRAINT "agent_job_runs_root_execution_id_agent_job_runs_id_fk" FOREIGN KEY ("root_execution_id") REFERENCES "public"."agent_job_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD CONSTRAINT "agent_job_runs_causation_run_id_agent_job_runs_id_fk" FOREIGN KEY ("causation_run_id") REFERENCES "public"."agent_job_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_job_runs_root_execution_id_idx" ON "agent_job_runs" USING btree ("root_execution_id");--> statement-breakpoint
CREATE INDEX "agent_job_runs_root_job_idx" ON "agent_job_runs" USING btree ("root_execution_id","job_id");--> statement-breakpoint
CREATE INDEX "agent_job_runs_job_trigger_created_idx" ON "agent_job_runs" USING btree ("job_id","trigger_type","created_at");--> statement-breakpoint
CREATE INDEX "agent_events_caused_by_run_id_idx" ON "agent_events" USING btree ("caused_by_run_id");