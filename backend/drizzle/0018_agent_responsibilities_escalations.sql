CREATE TABLE "agent_responsibilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"domain" varchar(20) NOT NULL,
	"responsibility_type" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"escalation_policy" varchar(20) DEFAULT 'none' NOT NULL,
	"escalation_target_agent_id" integer,
	"escalation_target_user_id" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_responsibilities_escalation_target_matches_policy" CHECK ((
        ("agent_responsibilities"."escalation_policy" = 'none') OR
        ("agent_responsibilities"."escalation_policy" = 'agent' AND "agent_responsibilities"."escalation_target_agent_id" IS NOT NULL) OR
        ("agent_responsibilities"."escalation_policy" = 'human' AND "agent_responsibilities"."escalation_target_user_id" IS NOT NULL) OR
        ("agent_responsibilities"."escalation_policy" = 'agent_then_human' AND "agent_responsibilities"."escalation_target_agent_id" IS NOT NULL AND "agent_responsibilities"."escalation_target_user_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "agent_operational_escalations" (
	"id" serial PRIMARY KEY NOT NULL,
	"responsibility_id" integer NOT NULL,
	"source_agent_id" integer NOT NULL,
	"target_agent_id" integer,
	"target_user_id" integer,
	"reason" text NOT NULL,
	"severity" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"entity_type" varchar(50),
	"entity_id" integer,
	"dedup_key" varchar(300) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" integer,
	"resolved_at" timestamp with time zone,
	"resolved_by" integer,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" integer,
	"dismiss_reason" text
);
--> statement-breakpoint
ALTER TABLE "agent_responsibilities" ADD CONSTRAINT "agent_responsibilities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_responsibilities" ADD CONSTRAINT "agent_responsibilities_escalation_target_agent_id_agents_id_fk" FOREIGN KEY ("escalation_target_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_responsibilities" ADD CONSTRAINT "agent_responsibilities_escalation_target_user_id_users_id_fk" FOREIGN KEY ("escalation_target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_responsibilities" ADD CONSTRAINT "agent_responsibilities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_escalations" ADD CONSTRAINT "agent_operational_escalations_responsibility_id_agent_responsibilities_id_fk" FOREIGN KEY ("responsibility_id") REFERENCES "public"."agent_responsibilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_escalations" ADD CONSTRAINT "agent_operational_escalations_source_agent_id_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_escalations" ADD CONSTRAINT "agent_operational_escalations_target_agent_id_agents_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_escalations" ADD CONSTRAINT "agent_operational_escalations_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_escalations" ADD CONSTRAINT "agent_operational_escalations_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_escalations" ADD CONSTRAINT "agent_operational_escalations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_escalations" ADD CONSTRAINT "agent_operational_escalations_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_responsibilities_agent_idx" ON "agent_responsibilities" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_responsibilities_domain_idx" ON "agent_responsibilities" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "agent_responsibilities_enabled_idx" ON "agent_responsibilities" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_operational_escalations_dedup_idx" ON "agent_operational_escalations" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "agent_operational_escalations_responsibility_idx" ON "agent_operational_escalations" USING btree ("responsibility_id");--> statement-breakpoint
CREATE INDEX "agent_operational_escalations_status_idx" ON "agent_operational_escalations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_operational_escalations_severity_idx" ON "agent_operational_escalations" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "agent_operational_escalations_target_agent_idx" ON "agent_operational_escalations" USING btree ("target_agent_id");--> statement-breakpoint
CREATE INDEX "agent_operational_escalations_target_user_idx" ON "agent_operational_escalations" USING btree ("target_user_id");