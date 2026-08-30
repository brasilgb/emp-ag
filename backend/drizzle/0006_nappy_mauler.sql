CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"department" varchar(30) NOT NULL,
	"description" text,
	"system_prompt" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"default_autonomy_level" varchar(20) DEFAULT 'read' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agent_tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"slug" varchar(150) NOT NULL,
	"description" text,
	"department" varchar(30) NOT NULL,
	"autonomy_level" varchar(20) NOT NULL,
	"handler" varchar(150) NOT NULL,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tools_slug_unique" UNIQUE("slug"),
	CONSTRAINT "agent_tools_handler_unique" UNIQUE("handler")
);
--> statement-breakpoint
CREATE TABLE "agent_tool_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"tool_id" integer NOT NULL,
	"can_use" boolean DEFAULT true NOT NULL,
	"requires_approval_override" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(200),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"agent_id" integer,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"user_id" integer,
	"conversation_id" integer,
	"tool_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"autonomy_level" varchar(20) NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" jsonb,
	"idempotency_key" varchar(100),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_id" integer NOT NULL,
	"requested_by_agent_id" integer,
	"requested_for_user_id" integer,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reason" text,
	"request_payload" jsonb,
	"decision_payload" jsonb,
	"approved_by_user_id" integer,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tool_permissions" ADD CONSTRAINT "agent_tool_permissions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_permissions" ADD CONSTRAINT "agent_tool_permissions_tool_id_agent_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."agent_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_tool_id_agent_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."agent_tools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_execution_id_agent_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."agent_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_requested_for_user_id_users_id_fk" FOREIGN KEY ("requested_for_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_department_idx" ON "agents" USING btree ("department");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_tools_department_idx" ON "agent_tools" USING btree ("department");--> statement-breakpoint
CREATE INDEX "agent_tools_autonomy_level_idx" ON "agent_tools" USING btree ("autonomy_level");--> statement-breakpoint
CREATE INDEX "agent_tools_is_active_idx" ON "agent_tools" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_permissions_agent_tool_idx" ON "agent_tool_permissions" USING btree ("agent_id","tool_id");--> statement-breakpoint
CREATE INDEX "agent_conversations_user_id_idx" ON "agent_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_conversations_status_idx" ON "agent_conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_messages_conversation_created_idx" ON "agent_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_executions_status_idx" ON "agent_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_executions_created_at_idx" ON "agent_executions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_executions_agent_id_idx" ON "agent_executions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_executions_user_id_idx" ON "agent_executions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_executions_conversation_id_idx" ON "agent_executions" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_executions_idempotency_idx" ON "agent_executions" USING btree ("agent_id","tool_id","idempotency_key") WHERE "agent_executions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_approvals_execution_id_idx" ON "agent_approvals" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "agent_approvals_status_idx" ON "agent_approvals" USING btree ("status");