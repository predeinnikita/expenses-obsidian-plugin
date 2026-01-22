import type { LanguageCode } from "./LanguageCode";

export interface ExpensesSettings {
  monthsToShow: number;
  baseCurrency: string;
  language: LanguageCode;
  notesPath: string;
}
