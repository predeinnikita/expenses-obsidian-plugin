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

  private isEntryActive(entry: Expense, month: MonthRef): boolean {
    if (!entry.startMonth) return true;
    return entry.startMonth <= month.key;
  }

  private monthlyBaseAmount(entry: Expense): number {
    return entry.cadence === "monthly" ? entry.amount : entry.amount / 12;
  }

  async calculateMonthlyTotals(months: MonthRef[], items: Expense[] = this.settings.expenses): Promise<MonthlyTotal[]> {
    const baseCurrency = this.settings.baseCurrency?.toUpperCase() || "RUB";
    const totals: MonthlyTotal[] = [];
    for (const month of months) {
      const breakdown: ExpenseBreakdown[] = [];
      let total = 0;
      const baseRate = await this.rateService.getRateForMonth(month, baseCurrency);

      for (const entry of items) {
        if (!this.isEntryActive(entry, month)) continue;
        const base = this.monthlyBaseAmount(entry);
        const rate = await this.rateService.getRateForMonth(month, entry.currency);
        const rub = base * rate;
        const baseValue = baseCurrency === "RUB" ? rub : rub / baseRate;
        total += baseValue;
        breakdown.push({
          expenseId: entry.id,
          name: entry.name,
          currency: entry.currency.toUpperCase(),
          amount: base,
          baseValue,
          rub,
          cadence: entry.cadence,
        });
      }

      totals.push({ month, totalBase: total, breakdown });
    }
    return totals;
  }
}
