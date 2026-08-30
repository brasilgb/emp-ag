CREATE TABLE "agent_interpretations" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"message_id" integer,
	"deterministic_agent" varchar(50),
	"deterministic_tool" varchar(150),
	"llm_agent" varchar(50),
	"llm_tool" varchar(150),
	"llm_arguments" jsonb,
	"llm_confidence" numeric(4, 3),
	"matched" boolean,
	"mode" varchar(20) NOT NULL,
	"latency_ms" integer,
	"provider" varchar(50),
	"model" varchar(100),
	"error" jsonb,
	"human_verdict" varchar(20),
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_interpretations" ADD CONSTRAINT "agent_interpretations_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_interpretations" ADD CONSTRAINT "agent_interpretations_message_id_agent_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."agent_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_interpretations" ADD CONSTRAINT "agent_interpretations_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_interpretations_conversation_id_idx" ON "agent_interpretations" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_interpretations_mode_idx" ON "agent_interpretations" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "agent_interpretations_matched_idx" ON "agent_interpretations" USING btree ("matched");--> statement-breakpoint
CREATE INDEX "agent_interpretations_created_at_idx" ON "agent_interpretations" USING btree ("created_at");