"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionGate } from "@/components/auth/permission-gate";
import { KanbanBoard } from "@/components/crm/kanban-board";
import { LeadForm } from "@/components/crm/lead-form";
import { LeadsTable } from "@/components/crm/leads-table";
import { useCreateLead } from "@/hooks/crm/use-leads";
import { toLeadInput } from "@/lib/crm/lead-input";
import type { LeadFormValues } from "@/lib/validation/crm-schema";
import { toErrorMessage } from "@/services/http";

export function LeadsPage() {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const createLead = useCreateLead();

  async function handleCreate(values: LeadFormValues) {
    try {
      const { data: lead } = await createLead.mutateAsync(toLeadInput(values));
      toast.success("Lead criado com sucesso.");
      setSheetOpen(false);
      router.push(`/leads/${lead.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar lead."));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">Funil comercial e prospecção.</p>
        </div>
        <PermissionGate permission="leads.create">
          <Button onClick={() => setSheetOpen(true)}>
            <Plus /> Novo Lead
          </Button>
        </PermissionGate>
      </div>

      <Tabs defaultValue="kanban">
        <TabsList>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
          <TabsTrigger value="lista">Lista</TabsTrigger>
        </TabsList>
        <TabsContent value="kanban" className="mt-4">
          <KanbanBoard />
        </TabsContent>
        <TabsContent value="lista" className="mt-4">
          <LeadsTable />
        </TabsContent>
      </Tabs>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Novo lead</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <LeadForm onSubmit={handleCreate} submitLabel="Criar lead" />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
