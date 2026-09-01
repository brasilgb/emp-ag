ALTER TABLE "agent_tools" ADD COLUMN "risk" varchar(10) DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tools" ADD COLUMN "mutates_data" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tools" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_tools_risk_idx" ON "agent_tools" USING btree ("risk");