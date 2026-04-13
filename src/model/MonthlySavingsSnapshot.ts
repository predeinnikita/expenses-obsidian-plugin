export interface MonthlySavingsSnapshot {
  type: "monthly-savings-snapshot";
  month: string;
  year: number;
  monthIndex: number;
  balances: Record<string, number>;
  notePath: string;
}
