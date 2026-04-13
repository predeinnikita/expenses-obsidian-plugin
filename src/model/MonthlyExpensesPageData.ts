import type { ManualExpense } from "./ManualExpense";
import type { MonthlySavingsSnapshot } from "./MonthlySavingsSnapshot";
import type { MonthlyExpensesPageFilters } from "./MonthlyExpensesPageFilters";
import type { MonthlyExpenseCategoryTotal } from "./MonthlyExpenseCategoryTotal";
import type { MonthlySavingsBaseTotal } from "./MonthlySavingsBaseTotal";
import type { MonthlyExpensesPageDiagnostics } from "./MonthlyExpensesPageDiagnostics";

export interface MonthlyExpensesPageData {
  filters: MonthlyExpensesPageFilters;
  expenses: ManualExpense[];
  categories: string[];
  availableYears: number[];
  availableMonths: string[];
  categoryTotals: MonthlyExpenseCategoryTotal[];
  snapshot?: MonthlySavingsSnapshot;
  savingsBaseTotal?: MonthlySavingsBaseTotal;
  diagnostics: MonthlyExpensesPageDiagnostics;
  savingsGrowthSeries: Array<{
    month: string;
    total: number;
  }>;
}
