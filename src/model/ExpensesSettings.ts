import type { Expense } from "./Expense";
import type { LanguageCode } from "./LanguageCode";

export interface ExpensesSettings {
  expenses: Expense[];
  incomes: Expense[];
  monthsToShow: number;
  baseCurrency: string;
  language: LanguageCode;
}
