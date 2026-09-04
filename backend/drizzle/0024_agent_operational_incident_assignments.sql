CREATE TABLE "agent_operational_incident_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_audit_log_id" integer NOT NULL,
	"assignee_user_id" integer NOT NULL,
	"assigned_by" integer NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_operational_incident_assignments_incident_audit_log_id_key" UNIQUE("incident_audit_log_id")
);
--> statement-breakpoint
ALTER TABLE "agent_operational_incident_assignments" ADD CONSTRAINT "agent_operational_incident_assignments_incident_audit_log_id_audit_logs_id_fk" FOREIGN KEY ("incident_audit_log_id") REFERENCES "public"."audit_logs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_incident_assignments" ADD CONSTRAINT "agent_operational_incident_assignments_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operational_incident_assignments" ADD CONSTRAINT "agent_operational_incident_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_operational_incident_assignments_assignee_user_id_idx" ON "agent_operational_incident_assignments" USING btree ("assignee_user_id");