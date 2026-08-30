import type {
  FinancialCategoryType,
  FinancialEntryStatus,
  FinancialEntryType,
  PaymentMethod,
} from "@/types/financial";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "--";
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return currencyFormatter.format(num);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "--";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "--";
  return dateFormatter.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return dateTimeFormatter.format(date);
}

export const ENTRY_TYPE_LABELS: Record<FinancialEntryType, string> = {
  income: "Receita",
  expense: "Despesa",
};

export const ENTRY_STATUS_LABELS: Record<FinancialEntryStatus, string> = {
  pending: "Pendente",
  paid: "Pago",
  cancelled: "Cancelado",
};

export const CATEGORY_TYPE_LABELS: Record<FinancialCategoryType, string> = {
  income: "Receita",
  expense: "Despesa",
  both: "Ambos",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: "Pix",
  bank_transfer: "Transferência bancária",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  cash: "Dinheiro",
  boleto: "Boleto",
  paypal: "PayPal",
  mercado_pago: "Mercado Pago",
  other: "Outro",
};
