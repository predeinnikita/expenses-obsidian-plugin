import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { ExpensesView, ExpensesSettingTab } from "./components";
import { CbrRateService } from "./services";
import {
  STRINGS,
  DEFAULT_SETTINGS,
  EXPENSES_VIEW_TYPE,
  Expense,
  ExpensesSettings,
  MonthlyTotal,
  ExpenseBreakdown,
  MonthRef
} from "./model";

export default class ExpensesPlugin extends Plugin {
  settings: ExpensesSettings = DEFAULT_SETTINGS;
  private rateService = new CbrRateService();

  async onload() {
    await this.loadSettings();

    this.registerView(
      EXPENSES_VIEW_TYPE,
      (leaf) => new ExpensesView(leaf, this),
    );

    this.addRibbonIcon("pie-chart", "Open Expenses", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-expenses-view",
      name: "Open expenses",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new ExpensesSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(EXPENSES_VIEW_TYPE);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(EXPENSES_VIEW_TYPE).first() ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice("Unable to open expenses view");
        return;
      }
      await leaf.setViewState({ type: EXPENSES_VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.app.workspace.getLeavesOfType(EXPENSES_VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof ExpensesView) {
        view.render();
      }
    });
  }

  getRecentMonths(): MonthRef[] {
    const result: MonthRef[] = [];
    const now = new Date();
    const count = Math.max(1, this.settings.monthsToShow);
    const strings = STRINGS[this.settings.language] ?? STRINGS.en;
    const locale = strings.locale;
    for (let i = 0; i < count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      result.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        key,
        label: d.toLocaleString(locale, { month: "short", year: "numeric" }),
      });
    }
    return result;
  }

  private isExpenseActive(expense: Expense, month: MonthRef): boolean {
    if (!expense.startMonth) return true;
    return expense.startMonth <= month.key;
  }

  private monthlyBaseAmount(expense: Expense): number {
    return expense.cadence === "monthly" ? expense.amount : expense.amount / 12;
  }

  async calculateMonthlyTotals(months: MonthRef[]): Promise<MonthlyTotal[]> {
    const baseCurrency = this.settings.baseCurrency?.toUpperCase() || "RUB";
    const totals: MonthlyTotal[] = [];
    for (const month of months) {
      const breakdown: ExpenseBreakdown[] = [];
      let total = 0;
      const baseRate = await this.rateService.getRateForMonth(month, baseCurrency);

      for (const expense of this.settings.expenses) {
        if (!this.isExpenseActive(expense, month)) continue;
        const base = this.monthlyBaseAmount(expense);
        const rate = await this.rateService.getRateForMonth(month, expense.currency);
        const rub = base * rate;
        const baseValue = baseCurrency === "RUB" ? rub : rub / baseRate;
        total += baseValue;
        breakdown.push({
          expenseId: expense.id,
          name: expense.name,
          currency: expense.currency.toUpperCase(),
          amount: base,
          baseValue,
          rub,
          cadence: expense.cadence,
        });
      }

      totals.push({ month, totalBase: total, breakdown });
    }
    return totals;
  }
}
