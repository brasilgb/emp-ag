CREATE TABLE "agent_operational_supervision_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger_source" varchar(20) NOT NULL,
	"actor_user_id" integer,
	"status" varchar(30) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"findings_count" integer,
	"responses_attempted" integer,
	"responses_succeeded" integer,
	"responses_failed" integer,
	"escalations_attempted" integer,
	"escalations_succeeded" integer,
	"escalations_failed" integer,
	"failed_count" integer,
	"error_code" varchar(100),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_operational_supervision_runs" ADD CONSTRAINT "agent_operational_supervision_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_operational_supervision_runs_started_at_idx" ON "agent_operational_supervision_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "agent_operational_supervision_runs_status_idx" ON "agent_operational_supervision_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_operational_supervision_runs_trigger_source_idx" ON "agent_operational_supervision_runs" USING btree ("trigger_source");