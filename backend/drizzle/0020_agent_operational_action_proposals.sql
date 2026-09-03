CREATE TABLE "agent_operational_action_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"follow_up_id" integer NOT NULL,
	"responsibility_id" integer NOT NULL,
	"owner_agent_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"objective" text NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"action_plan_id" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" integer,
	"submitted_at" timestamp with time zone,
	"planned_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" integer,
	"failure_reason" text
);
--> statement-breakpoint
ALTER TABLE "agent_operational_action_proposals" ADD CONSTRAINT "agent_operational_action_proposals_follow_up_id_agent_operational_follow_ups_id_fk" FOREIGN KEY ("follow_up_id") REFERENCES "public"."agent_operational_follow_ups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_action_proposals" ADD CONSTRAINT "agent_operational_action_proposals_responsibility_id_agent_responsibilities_id_fk" FOREIGN KEY ("responsibility_id") REFERENCES "public"."agent_responsibilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_action_proposals" ADD CONSTRAINT "agent_operational_action_proposals_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_action_proposals" ADD CONSTRAINT "agent_operational_action_proposals_action_plan_id_agent_action_plans_id_fk" FOREIGN KEY ("action_plan_id") REFERENCES "public"."agent_action_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_action_proposals" ADD CONSTRAINT "agent_operational_action_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_action_proposals" ADD CONSTRAINT "agent_operational_action_proposals_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_action_proposals" ADD CONSTRAINT "agent_operational_action_proposals_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_operational_action_proposals_follow_up_idx" ON "agent_operational_action_proposals" USING btree ("follow_up_id");--> statement-breakpoint
CREATE INDEX "agent_operational_action_proposals_status_idx" ON "agent_operational_action_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_operational_action_proposals_action_plan_idx" ON "agent_operational_action_proposals" USING btree ("action_plan_id");--> statement-breakpoint
CREATE INDEX "agent_operational_action_proposals_created_at_idx" ON "agent_operational_action_proposals" USING btree ("created_at");