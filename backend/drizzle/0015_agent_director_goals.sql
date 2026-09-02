CREATE TABLE "agent_director_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"domain" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"owner_user_id" integer,
	"created_by" integer NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"target_date" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"target_type" varchar(20) DEFAULT 'metric' NOT NULL,
	"target_value" numeric(18, 4),
	"current_value" numeric(18, 4),
	"unit" varchar(30),
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"health" varchar(20) DEFAULT 'unknown' NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_director_goal_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"metric_key" varchar(100) NOT NULL,
	"label" varchar(255) NOT NULL,
	"source_domain" varchar(20) NOT NULL,
	"target_value" numeric(18, 4) NOT NULL,
	"current_value" numeric(18, 4),
	"unit" varchar(30),
	"direction" varchar(20) DEFAULT 'increase' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_director_goal_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"progress_percent" integer NOT NULL,
	"health" varchar(20) NOT NULL,
	"metric_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"factors" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_director_initiatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"domain" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"rationale" text NOT NULL,
	"expected_impact" text,
	"origin" varchar(30) DEFAULT 'manual' NOT NULL,
	"recommendation_key" varchar(300),
	"owner_user_id" integer,
	"created_by" integer,
	"action_plan_id" integer,
	"started_at" timestamp with time zone,
	"target_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_director_goals" ADD CONSTRAINT "agent_director_goals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_goals" ADD CONSTRAINT "agent_director_goals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_goal_metrics" ADD CONSTRAINT "agent_director_goal_metrics_goal_id_agent_director_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."agent_director_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_goal_evaluations" ADD CONSTRAINT "agent_director_goal_evaluations_goal_id_agent_director_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."agent_director_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_initiatives" ADD CONSTRAINT "agent_director_initiatives_goal_id_agent_director_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."agent_director_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_initiatives" ADD CONSTRAINT "agent_director_initiatives_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_initiatives" ADD CONSTRAINT "agent_director_initiatives_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_director_initiatives" ADD CONSTRAINT "agent_director_initiatives_action_plan_id_agent_action_plans_id_fk" FOREIGN KEY ("action_plan_id") REFERENCES "public"."agent_action_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_director_goals_status_idx" ON "agent_director_goals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_director_goals_health_idx" ON "agent_director_goals" USING btree ("health");--> statement-breakpoint
CREATE INDEX "agent_director_goals_domain_idx" ON "agent_director_goals" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "agent_director_goals_owner_idx" ON "agent_director_goals" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "agent_director_goals_target_date_idx" ON "agent_director_goals" USING btree ("target_date");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_director_goal_metrics_goal_key_idx" ON "agent_director_goal_metrics" USING btree ("goal_id","metric_key");--> statement-breakpoint
CREATE INDEX "agent_director_goal_metrics_goal_idx" ON "agent_director_goal_metrics" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "agent_director_goal_evaluations_goal_idx" ON "agent_director_goal_evaluations" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "agent_director_goal_evaluations_evaluated_at_idx" ON "agent_director_goal_evaluations" USING btree ("evaluated_at");--> statement-breakpoint
CREATE INDEX "agent_director_initiatives_goal_idx" ON "agent_director_initiatives" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "agent_director_initiatives_status_idx" ON "agent_director_initiatives" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_director_initiatives_owner_idx" ON "agent_director_initiatives" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_director_initiatives_recommendation_idx" ON "agent_director_initiatives" USING btree ("goal_id","recommendation_key") WHERE "agent_director_initiatives"."recommendation_key" IS NOT NULL;