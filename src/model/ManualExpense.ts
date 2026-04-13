export interface ManualExpense {
  id: string;
  type: "manual-expense";
  date: string;
  category: string;
  amount: number;
  currency: string;
  month: string;
  year: number;
  monthIndex: number;
  notePath: string;
}
