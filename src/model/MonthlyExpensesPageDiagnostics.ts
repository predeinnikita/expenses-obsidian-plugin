export interface MonthlyExpensesPageDiagnostics {
  invalidManualExpenseNotes: number;
  invalidMonthlySavingsNotes: number;
  duplicateManualExpenseIds: string[];
  duplicateSavingsMonths: string[];
}
