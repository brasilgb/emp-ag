export type { Paginated, PaginationMeta } from "./shared";

export type FinancialEntryType = "income" | "expense";

// Status real (persistido): "pending" | "paid" | "cancelled". "overdue"
// nunca é persistido — é sempre derivado no backend (ver
// backend/src/routes/financial/helpers.ts) e só existe aqui como valor de
// leitura (isOverdue) ou de filtro na listagem.
export type FinancialEntryStatus = "pending" | "paid" | "cancelled";
export type FinancialEntryStatusFilter = FinancialEntryStatus | "overdue";

export type FinancialCategoryType = "income" | "expense" | "both";

export const PAYMENT_METHODS = [
  "pix",
  "bank_transfer",
  "credit_card",
  "debit_card",
  "cash",
  "boleto",
  "paypal",
  "mercado_pago",
  "other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface FinancialCategory {
  id: number;
  name: string;
  slug: string;
  type: FinancialCategoryType;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialEntry {
  id: number;
  type: FinancialEntryType;
  categoryId: number;
  categoryName: string;
  clientId: number | null;
  clientName: string | null;
  projectId: number | null;
  projectName: string | null;
  description: string;
  // Vêm do backend como string (coluna numeric) para preservar precisão.
  amount: string;
  paidAmount: string;
  remainingAmount: string;
  status: FinancialEntryStatus;
  isOverdue: boolean;
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
  competenceDate: string;
  paymentMethod: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialPayment {
  id: number;
  entryId: number;
  amount: string;
  paidAt: string;
  paymentMethod: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
}

export interface FinancialStats {
  receivablePending: string;
  payablePending: string;
  incomePaidThisMonth: string;
  expensePaidThisMonth: string;
  resultThisMonth: string;
  overdueReceivable: string;
  overduePayable: string;
}

export interface FinancialHistoryEntry {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  userId: number | null;
  userName: string | null;
  oldData: unknown;
  newData: unknown;
  metadata: unknown;
  createdAt: string;
}

