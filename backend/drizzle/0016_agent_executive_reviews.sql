CREATE TABLE "agent_executive_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"initiative_id" integer NOT NULL,
	"action_plan_id" integer NOT NULL,
	"created_by" integer,
	"review_type" varchar(30) DEFAULT 'initiative_outcome' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"outcome" varchar(30),
	"summary" text,
	"expected_result" text,
	"actual_result" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assessment" text,
	"confidence" numeric(4, 3),
	"recommendation_type" varchar(20),
	"recommendation" jsonb,
	"resulting_initiative_id" integer,
	"resulting_decision_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_executive_reviews" ADD CONSTRAINT "agent_executive_reviews_goal_id_agent_director_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."agent_director_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executive_reviews" ADD CONSTRAINT "agent_executive_reviews_initiative_id_agent_director_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."agent_director_initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executive_reviews" ADD CONSTRAINT "agent_executive_reviews_action_plan_id_agent_action_plans_id_fk" FOREIGN KEY ("action_plan_id") REFERENCES "public"."agent_action_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executive_reviews" ADD CONSTRAINT "agent_executive_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executive_reviews" ADD CONSTRAINT "agent_executive_reviews_resulting_initiative_id_agent_director_initiatives_id_fk" FOREIGN KEY ("resulting_initiative_id") REFERENCES "public"."agent_director_initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executive_reviews" ADD CONSTRAINT "agent_executive_reviews_resulting_decision_id_agent_director_decisions_id_fk" FOREIGN KEY ("resulting_decision_id") REFERENCES "public"."agent_director_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_executive_reviews_action_plan_idx" ON "agent_executive_reviews" USING btree ("action_plan_id");--> statement-breakpoint
CREATE INDEX "agent_executive_reviews_initiative_idx" ON "agent_executive_reviews" USING btree ("initiative_id");--> statement-breakpoint
CREATE INDEX "agent_executive_reviews_goal_idx" ON "agent_executive_reviews" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "agent_executive_reviews_status_idx" ON "agent_executive_reviews" USING btree ("status");