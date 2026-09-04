CREATE TABLE "agent_operational_incident_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_audit_log_id" integer NOT NULL,
	"status" varchar(20) NOT NULL,
	"reviewed_by" integer NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_operational_incident_reviews_incident_audit_log_id_key" UNIQUE("incident_audit_log_id")
);
--> statement-breakpoint
ALTER TABLE "agent_operational_incident_reviews" ADD CONSTRAINT "agent_operational_incident_reviews_incident_audit_log_id_audit_logs_id_fk" FOREIGN KEY ("incident_audit_log_id") REFERENCES "public"."audit_logs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_incident_reviews" ADD CONSTRAINT "agent_operational_incident_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_operational_incident_reviews_status_idx" ON "agent_operational_incident_reviews" USING btree ("status");