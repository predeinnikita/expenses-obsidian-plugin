export interface MonthlyExpenseCategoryTotal {
  category: string;
  amount: number;
  currencyBreakdown: Record<string, number>;
  baseAmount: number;
}
