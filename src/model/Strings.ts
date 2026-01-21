import type { LanguageCode } from "./LanguageCode";

export type Strings = Record<
  LanguageCode,
  {
    locale: string;
    heading: string;
    subtitle: string;
    addExpensesHint: string;
    noData: string;
    monthlyExpensesTitle: (month: string) => string;
    monthlyIncomeTitle: (month: string) => string;
    tableHeaders: {
      name: string;
      cadence: string;
      amount: string;
      converted: (month: string, currency: string) => string;
    };
    cadenceLabel: { monthly: string; yearly: string };
    totalsTitle: (currency: string) => string;
    trendTitle: (currency: string) => string;
    waterfallLabels: { income: string; expense: string; balance: string };
    pieTitle: (month: string) => string;
    settingsTitle: string;
    baseCurrency: string;
    baseCurrencyDesc: string;
    monthsToShow: string;
    monthsToShowDesc: string;
    notesPath: string;
    notesPathDesc: string;
    expensesList: string;
    incomesList: string;
    add: string;
    edit: string;
    delete: string;
    since: string;
    expenseModalTitle: string;
    incomeModalTitle: string;
    name: string;
    amount: string;
    currency: string;
    cadence: string;
    cadenceDesc: string;
    start: string;
    startDesc: string;
    save: string;
    missingFields: string;
    duplicateName: string;
    month: string;
    total: string;
    language: string;
  }
>;
