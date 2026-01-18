import type { ExpenseBreakdown } from "./ExpenseBreakdown";
import type { MonthRef } from "./MonthRef";

export interface MonthlyTotal {
  month: MonthRef;
  totalBase: number;
  breakdown: ExpenseBreakdown[];
}
