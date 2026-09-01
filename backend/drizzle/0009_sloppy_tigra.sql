CREATE TABLE "agent_action_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"requested_by" integer NOT NULL,
	"objective" text NOT NULL,
	"summary" text NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"llm_provider" varchar(30),
	"llm_model" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_action_plan_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"action_id" varchar(50) NOT NULL,
	"agent" varchar(50) NOT NULL,
	"agent_id" integer NOT NULL,
	"tool" varchar(150) NOT NULL,
	"tool_id" integer NOT NULL,
	"arguments" jsonb NOT NULL,
	"dependencies" jsonb,
	"reason" text,
	"confidence" numeric(4, 3),
	"risk" varchar(10) NOT NULL,
	"decision" varchar(20) NOT NULL,
	"decision_reason" text,
	"execution_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_approvals" ALTER COLUMN "execution_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD COLUMN "plan_item_id" integer;--> statement-breakpoint
ALTER TABLE "agent_action_plans" ADD CONSTRAINT "agent_action_plans_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_plan_items" ADD CONSTRAINT "agent_action_plan_items_plan_id_agent_action_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."agent_action_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_plan_items" ADD CONSTRAINT "agent_action_plan_items_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_plan_items" ADD CONSTRAINT "agent_action_plan_items_tool_id_agent_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."agent_tools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_action_plans_status_idx" ON "agent_action_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_action_plans_requested_by_idx" ON "agent_action_plans" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "agent_action_plans_created_at_idx" ON "agent_action_plans" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_action_plan_items_plan_id_idx" ON "agent_action_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "agent_action_plan_items_execution_status_idx" ON "agent_action_plan_items" USING btree ("execution_status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_action_plan_items_plan_action_idx" ON "agent_action_plan_items" USING btree ("plan_id","action_id");--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_plan_item_id_agent_action_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."agent_action_plan_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_approvals_plan_item_id_idx" ON "agent_approvals" USING btree ("plan_item_id");