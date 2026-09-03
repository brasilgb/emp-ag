export const queryKeys = {
  me: ["auth", "me"] as const,

  crm: {
    clients: (params?: unknown) => ["crm", "clients", params ?? {}] as const,
    client: (id: number) => ["crm", "clients", id] as const,
    clientContacts: (clientId: number) => ["crm", "clients", clientId, "contacts"] as const,
    clientActivities: (clientId: number, params?: unknown) =>
      ["crm", "clients", clientId, "activities", params ?? {}] as const,

    leads: (params?: unknown) => ["crm", "leads", params ?? {}] as const,
    lead: (id: number) => ["crm", "leads", id] as const,
    leadActivities: (leadId: number, params?: unknown) =>
      ["crm", "leads", leadId, "activities", params ?? {}] as const,

    pipeline: ["crm", "pipeline"] as const,
  },

  projects: {
    list: (params?: unknown) => ["projects", "list", params ?? {}] as const,
    detail: (id: number) => ["projects", "detail", id] as const,
    stats: ["projects", "stats"] as const,
    history: (id: number, params?: unknown) =>
      ["projects", "detail", id, "history", params ?? {}] as const,

    milestones: (projectId: number) => ["projects", "detail", projectId, "milestones"] as const,

    tasks: (projectId: number, params?: unknown) =>
      ["projects", "detail", projectId, "tasks", params ?? {}] as const,
    task: (projectId: number, taskId: number) =>
      ["projects", "detail", projectId, "tasks", taskId] as const,
    board: (projectId: number) => ["projects", "detail", projectId, "board"] as const,
    comments: (projectId: number, taskId: number, params?: unknown) =>
      ["projects", "detail", projectId, "tasks", taskId, "comments", params ?? {}] as const,
    taskHistory: (projectId: number, taskId: number, params?: unknown) =>
      ["projects", "detail", projectId, "tasks", taskId, "history", params ?? {}] as const,
  },

  users: {
    directory: ["users", "directory"] as const,
  },

  financial: {
    entries: (params?: unknown) => ["financial", "entries", params ?? {}] as const,
    entry: (id: number) => ["financial", "entries", id] as const,
    payments: (entryId: number, params?: unknown) =>
      ["financial", "entries", entryId, "payments", params ?? {}] as const,
    history: (entryId: number) => ["financial", "entries", entryId, "history"] as const,
    categories: (params?: unknown) => ["financial", "categories", params ?? {}] as const,
    stats: ["financial", "stats"] as const,
  },

  support: {
    tickets: (params?: unknown) => ["support", "tickets", params ?? {}] as const,
    ticket: (id: number) => ["support", "tickets", id] as const,
    messages: (ticketId: number, params?: unknown) =>
      ["support", "tickets", ticketId, "messages", params ?? {}] as const,
    history: (ticketId: number, params?: unknown) =>
      ["support", "tickets", ticketId, "history", params ?? {}] as const,
    categories: (params?: unknown) => ["support", "categories", params ?? {}] as const,
    stats: ["support", "stats"] as const,
  },

  customerSuccess: {
    accounts: (params?: unknown) => ["customer-success", "accounts", params ?? {}] as const,
    account: (id: number) => ["customer-success", "accounts", id] as const,
    activities: (accountId: number, params?: unknown) =>
      ["customer-success", "accounts", accountId, "activities", params ?? {}] as const,
    opportunities: (params?: unknown) => ["customer-success", "opportunities", params ?? {}] as const,
    stats: ["customer-success", "stats"] as const,
  },

  agents: {
    list: ["agents", "list"] as const,
    detail: (id: number) => ["agents", "detail", id] as const,
    tools: (params?: unknown) => ["agents", "tools", params ?? {}] as const,
    agentTools: (agentId: number) => ["agents", "detail", agentId, "tools"] as const,
    executions: (params?: unknown) => ["agents", "executions", params ?? {}] as const,
    execution: (id: number) => ["agents", "executions", id] as const,
    approvals: (params?: unknown) => ["agents", "approvals", params ?? {}] as const,
    conversations: (params?: unknown) => ["agents", "conversations", params ?? {}] as const,
    conversation: (id: number) => ["agents", "conversations", id] as const,
    interpreterStats: ["agents", "interpreter", "stats"] as const,
    actionPlans: (params?: unknown) => ["agents", "action-plans", params ?? {}] as const,
    actionPlan: (id: number) => ["agents", "action-plans", id] as const,
    jobs: (params?: unknown) => ["agents", "jobs", params ?? {}] as const,
    job: (id: number) => ["agents", "jobs", id] as const,
    jobRuns: (jobId: number, params?: unknown) => ["agents", "jobs", jobId, "runs", params ?? {}] as const,
    jobRun: (id: number) => ["agents", "job-runs", id] as const,
    events: (params?: unknown) => ["agents", "events", params ?? {}] as const,
    event: (id: number) => ["agents", "events", id] as const,
    eventCatalog: ["agents", "events", "catalog"] as const,
    eventRules: (params?: unknown) => ["agents", "event-rules", params ?? {}] as const,
    eventRule: (id: number) => ["agents", "event-rules", id] as const,
    jobRunDetail: (id: number) => ["agents", "job-runs", id, "detail"] as const,
    jobRunLineage: (id: number) => ["agents", "job-runs", id, "lineage"] as const,
    operationsSummary: (params?: unknown) => ["agents", "operations", "summary", params ?? {}] as const,
    incidents: (params?: unknown) => ["agents", "incidents", params ?? {}] as const,
    auditLogs: (params?: unknown) => ["agents", "audit-logs", params ?? {}] as const,
    globalAutonomy: ["agents", "autonomy"] as const,
    settings: ["agents", "settings"] as const,
    jobSettings: (jobId: number) => ["agents", "jobs", jobId, "settings"] as const,
    directorBrief: ["agents", "director", "brief"] as const,
    directorSignals: ["agents", "director", "signals"] as const,
    directorSignal: (id: string) => ["agents", "director", "signals", id] as const,
    directorDecisions: (params?: unknown) => ["agents", "director", "decisions", params ?? {}] as const,
    directorDecisionsOverview: ["agents", "director", "decisions", "overview"] as const,
    directorDecision: (id: number) => ["agents", "director", "decisions", id] as const,
    directorGoals: (params?: unknown) => ["agents", "director", "goals", params ?? {}] as const,
    directorGoalsOverview: ["agents", "director", "goals", "overview"] as const,
    directorGoal: (id: number) => ["agents", "director", "goals", id] as const,
    goalMetricCatalog: ["agents", "director", "goals", "metrics", "catalog"] as const,
    directorInitiatives: (params?: unknown) => ["agents", "director", "initiatives", params ?? {}] as const,
    directorInitiative: (id: number) => ["agents", "director", "initiatives", id] as const,
    directorInitiativeExecution: (id: number) => ["agents", "director", "initiatives", id, "execution"] as const,
    directorInitiativeReview: (id: number) => ["agents", "director", "initiatives", id, "review"] as const,
    directorMemories: (params?: unknown) => ["agents", "director", "memories", params ?? {}] as const,
    directorMemory: (id: number) => ["agents", "director", "memories", id] as const,
    recoveryStatus: ["agents", "recovery", "status"] as const,
    recoveryStale: ["agents", "recovery", "stale"] as const,
    operationalHealth: ["agents", "operations", "health"] as const,
    operationalIncidents: ["agents", "operations", "incidents"] as const,
    operationalSupervisionScheduler: ["agents", "operations", "scheduler"] as const,
    responsibilities: (params?: unknown) => ["agents", "responsibilities", params ?? {}] as const,
    responsibility: (id: number) => ["agents", "responsibilities", id] as const,
    escalations: (params?: unknown) => ["agents", "escalations", params ?? {}] as const,
    escalation: (id: number) => ["agents", "escalations", id] as const,
    followUps: (params?: unknown) => ["agents", "follow-ups", params ?? {}] as const,
    followUp: (id: number) => ["agents", "follow-ups", id] as const,
  },
};
