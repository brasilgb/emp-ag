import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectDetailPage } from "@/components/projects/project-detail-page";

export const metadata: Metadata = { title: "Projeto" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = Number(id);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    notFound();
  }

  return <ProjectDetailPage projectId={projectId} />;
}
