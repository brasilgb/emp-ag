CREATE TABLE "agent_director_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"deduplication_key" varchar(300) NOT NULL,
	"signal_type" varchar(100) NOT NULL,
	"domain" varchar(20) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" integer,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"severity" varchar(20) NOT NULL,
	"impact" varchar(20) NOT NULL,
	"urgency" varchar(20) NOT NULL,
	"priority_score" integer NOT NULL,
	"priority_factors" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"requires_human_attention" boolean DEFAULT false NOT NULL,
	"first_detected_at" timestamp with time zone NOT NULL,
	"last_detected_at" timestamp with time zone NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" integer,
	"action_plan_id" integer,
	"assigned_user_id" integer,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" integer,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" integer,
	"dismiss_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_director_decisions" ADD CONSTRAINT "agent_director_decisions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_decisions" ADD CONSTRAINT "agent_director_decisions_action_plan_id_agent_action_plans_id_fk" FOREIGN KEY ("action_plan_id") REFERENCES "public"."agent_action_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_decisions" ADD CONSTRAINT "agent_director_decisions_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_decisions" ADD CONSTRAINT "agent_director_decisions_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_decisions" ADD CONSTRAINT "agent_director_decisions_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_director_decisions_dedup_idx" ON "agent_director_decisions" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "agent_director_decisions_status_idx" ON "agent_director_decisions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_director_decisions_domain_idx" ON "agent_director_decisions" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "agent_director_decisions_priority_idx" ON "agent_director_decisions" USING btree ("priority_score");--> statement-breakpoint
CREATE INDEX "agent_director_decisions_assigned_user_idx" ON "agent_director_decisions" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "agent_director_decisions_last_detected_idx" ON "agent_director_decisions" USING btree ("last_detected_at");--> statement-breakpoint
CREATE INDEX "agent_director_decisions_requires_attention_idx" ON "agent_director_decisions" USING btree ("requires_human_attention");