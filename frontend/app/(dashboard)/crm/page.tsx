import type { Metadata } from "next";

import { CrmOverview } from "@/components/crm/crm-overview";

export const metadata: Metadata = { title: "CRM" };

export default function CrmPage() {
  return <CrmOverview />;
}
