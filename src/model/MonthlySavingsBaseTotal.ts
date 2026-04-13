export interface MonthlySavingsBaseTotal {
  month: string;
  baseCurrency: string;
  total: number;
  convertedBalances: Array<{
    currency: string;
    amount: number;
    baseValue: number;
  }>;
}
