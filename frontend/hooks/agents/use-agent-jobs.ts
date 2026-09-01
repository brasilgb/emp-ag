"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type CreateJobInput,
  type ListJobsParams,
  cancelJob,
  createJob,
  getJob,
  getJobRun,
  listJobRuns,
  listJobs,
  pauseJob,
  resumeJob,
  runJob,
} from "@/services/agents";

// Agentes v1.3 — Jobs, Runs, Delegation & Controlled Autonomy (correio.md).
// Mesmo padrão de hooks/agents/use-action-plans.ts.
export function useAgentJobs(params: ListJobsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.jobs(params),
    queryFn: () => listJobs(params),
    placeholderData: keepPreviousData,
  });
}

export function useAgentJob(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.job(id ?? 0),
    queryFn: () => getJob(id as number),
    enabled: id !== null,
  });
}

export function useAgentJobRuns(jobId: number | null, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.agents.jobRuns(jobId ?? 0, params),
    queryFn: () => listJobRuns(jobId as number, params),
    enabled: jobId !== null,
    refetchInterval: 5000,
  });
}

export function useAgentJobRun(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.jobRun(id ?? 0),
    queryFn: () => getJobRun(id as number),
    enabled: id !== null,
  });
}

function useInvalidateJobs() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: ["agents", "jobs"] });
    queryClient.invalidateQueries({ queryKey: ["agents", "job-runs"] });
    queryClient.invalidateQueries({ queryKey: ["agents", "approvals"] });
  };
}

export function useCreateAgentJob() {
  const invalidate = useInvalidateJobs();

  return useMutation({
    mutationFn: (input: CreateJobInput) => createJob(input),
    onSuccess: invalidate,
  });
}

export function useRunAgentJob() {
  const invalidate = useInvalidateJobs();

  return useMutation({
    mutationFn: (id: number) => runJob(id),
    onSuccess: invalidate,
  });
}

export function usePauseAgentJob() {
  const invalidate = useInvalidateJobs();

  return useMutation({
    mutationFn: (id: number) => pauseJob(id),
    onSuccess: invalidate,
  });
}

export function useResumeAgentJob() {
  const invalidate = useInvalidateJobs();

  return useMutation({
    mutationFn: (id: number) => resumeJob(id),
    onSuccess: invalidate,
  });
}

export function useCancelAgentJob() {
  const invalidate = useInvalidateJobs();

  return useMutation({
    mutationFn: (id: number) => cancelJob(id),
    onSuccess: invalidate,
  });
}
