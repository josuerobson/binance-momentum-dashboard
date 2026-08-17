export function formatMoney(value: number | null | undefined, digits = 2) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value ?? 0);
}

export function formatPercent(value: number | null | undefined, digits = 2) {
  const number = value ?? 0;
  return `${number >= 0 ? "+" : ""}${formatMoney(number, digits)}%`;
}

export function formatDateTime(value: string | number | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}
