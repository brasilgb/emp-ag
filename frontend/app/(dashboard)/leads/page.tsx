import type { Metadata } from "next";

import { LeadsPage } from "@/components/crm/leads-page";

export const metadata: Metadata = { title: "Leads" };

export default function Page() {
  return <LeadsPage />;
}
