CREATE TABLE "agent_strategic_memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"memory_type" varchar(30) NOT NULL,
	"domain" varchar(20) NOT NULL,
	"title" varchar(255),
	"summary" text,
	"lesson" text,
	"outcome" varchar(30),
	"confidence" numeric(4, 3),
	"importance" varchar(10),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_goal_id" integer NOT NULL,
	"source_initiative_id" integer NOT NULL,
	"source_review_id" integer,
	"source_decision_id" integer,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_strategic_memories" ADD CONSTRAINT "agent_strategic_memories_source_goal_id_agent_director_goals_id_fk" FOREIGN KEY ("source_goal_id") REFERENCES "public"."agent_director_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_strategic_memories" ADD CONSTRAINT "agent_strategic_memories_source_initiative_id_agent_director_initiatives_id_fk" FOREIGN KEY ("source_initiative_id") REFERENCES "public"."agent_director_initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_strategic_memories" ADD CONSTRAINT "agent_strategic_memories_source_review_id_agent_executive_reviews_id_fk" FOREIGN KEY ("source_review_id") REFERENCES "public"."agent_executive_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_strategic_memories" ADD CONSTRAINT "agent_strategic_memories_source_decision_id_agent_director_decisions_id_fk" FOREIGN KEY ("source_decision_id") REFERENCES "public"."agent_director_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_strategic_memories" ADD CONSTRAINT "agent_strategic_memories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_strategic_memories_source_review_idx" ON "agent_strategic_memories" USING btree ("source_review_id") WHERE "agent_strategic_memories"."source_review_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_strategic_memories_domain_idx" ON "agent_strategic_memories" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "agent_strategic_memories_status_idx" ON "agent_strategic_memories" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_strategic_memories_type_idx" ON "agent_strategic_memories" USING btree ("memory_type");--> statement-breakpoint
CREATE INDEX "agent_strategic_memories_goal_idx" ON "agent_strategic_memories" USING btree ("source_goal_id");--> statement-breakpoint
CREATE INDEX "agent_strategic_memories_initiative_idx" ON "agent_strategic_memories" USING btree ("source_initiative_id");