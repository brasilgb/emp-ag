CREATE TABLE "agent_operational_follow_ups" (
	"id" serial PRIMARY KEY NOT NULL,
	"responsibility_id" integer NOT NULL,
	"escalation_id" integer,
	"source_type" varchar(20) NOT NULL,
	"source_id" integer,
	"owner_agent_id" integer NOT NULL,
	"assigned_user_id" integer,
	"title" varchar(200) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"due_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"waiting_reason" text,
	"waiting_until" timestamp with time zone,
	"dedup_key" varchar(300) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" integer,
	"resolution" text,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" integer,
	"dismiss_reason" text
);
--> statement-breakpoint
ALTER TABLE "agent_operational_follow_ups" ADD CONSTRAINT "agent_operational_follow_ups_responsibility_id_agent_responsibilities_id_fk" FOREIGN KEY ("responsibility_id") REFERENCES "public"."agent_responsibilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_follow_ups" ADD CONSTRAINT "agent_operational_follow_ups_escalation_id_agent_operational_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "public"."agent_operational_escalations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_follow_ups" ADD CONSTRAINT "agent_operational_follow_ups_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_follow_ups" ADD CONSTRAINT "agent_operational_follow_ups_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_follow_ups" ADD CONSTRAINT "agent_operational_follow_ups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_follow_ups" ADD CONSTRAINT "agent_operational_follow_ups_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_follow_ups" ADD CONSTRAINT "agent_operational_follow_ups_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_operational_follow_ups_dedup_idx" ON "agent_operational_follow_ups" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "agent_operational_follow_ups_status_idx" ON "agent_operational_follow_ups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_operational_follow_ups_owner_idx" ON "agent_operational_follow_ups" USING btree ("owner_agent_id");--> statement-breakpoint
CREATE INDEX "agent_operational_follow_ups_assigned_user_idx" ON "agent_operational_follow_ups" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "agent_operational_follow_ups_responsibility_idx" ON "agent_operational_follow_ups" USING btree ("responsibility_id");--> statement-breakpoint
CREATE INDEX "agent_operational_follow_ups_escalation_idx" ON "agent_operational_follow_ups" USING btree ("escalation_id");--> statement-breakpoint
CREATE INDEX "agent_operational_follow_ups_due_at_idx" ON "agent_operational_follow_ups" USING btree ("due_at");