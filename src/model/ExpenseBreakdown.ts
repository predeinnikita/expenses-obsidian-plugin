import type { ExpenseCadence } from "./ExpenseCadence";

export interface ExpenseBreakdown {
  expenseId: string;
  name: string;
  currency: string;
  amount: number;
  baseValue: number;
  rub: number;
  cadence: ExpenseCadence;
}
