import type { ExpenseCadence } from "./ExpenseCadence";

export interface Expense {
  id: string;
  name: string;
  amount: number;
  currency: string;
  cadence: ExpenseCadence;
  startMonth?: string; // YYYY-MM
}
