CREATE TABLE "agent_operational_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"scope" varchar(20) NOT NULL,
	"scope_id" integer,
	"value" jsonb NOT NULL,
	"value_type" varchar(20) NOT NULL,
	"updated_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_operational_settings" ADD CONSTRAINT "agent_operational_settings_scope_id_agent_jobs_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_settings" ADD CONSTRAINT "agent_operational_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_operational_settings_global_idx" ON "agent_operational_settings" USING btree ("key") WHERE "agent_operational_settings"."scope" = 'global';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_operational_settings_job_idx" ON "agent_operational_settings" USING btree ("key","scope_id") WHERE "agent_operational_settings"."scope" = 'job';--> statement-breakpoint
CREATE INDEX "agent_operational_settings_scope_idx" ON "agent_operational_settings" USING btree ("scope","scope_id");