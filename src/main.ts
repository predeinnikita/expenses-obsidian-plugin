import {
  App,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  requestUrl,
} from "obsidian";
import * as echarts from "echarts";

type ExpenseCadence = "monthly" | "yearly";

interface Expense {
  id: string;
  name: string;
  amount: number;
  currency: string;
  cadence: ExpenseCadence;
  startMonth?: string; // YYYY-MM
}

interface ExpensesSettings {
  expenses: Expense[];
  monthsToShow: number;
}

interface MonthRef {
  year: number;
  month: number; // 0 based
  key: string; // YYYY-MM
  label: string; // e.g. Jan 2025
}

interface ExpenseBreakdown {
  expenseId: string;
  name: string;
  currency: string;
  amount: number;
  rub: number;
  cadence: ExpenseCadence;
}

interface MonthlyTotal {
  month: MonthRef;
  totalRub: number;
  breakdown: ExpenseBreakdown[];
}

const DEFAULT_SETTINGS: ExpensesSettings = {
  expenses: [],
  monthsToShow: 6,
};

const EXPENSES_VIEW_TYPE = "expenses-view";
const CBR_BASE = "https://www.cbr-xml-daily.ru";

class CbrRateService {
  private cache = new Map<string, Record<string, number>>();

  async getRateForMonth(month: MonthRef, currency: string): Promise<number> {
    const upper = currency.toUpperCase();
    if (upper === "RUB") return 1;

    const key = month.key;
    let rates = this.cache.get(key);
    if (!rates) {
      rates = await this.fetchMonthRates(month);
      this.cache.set(key, rates);
    }

    return rates[upper] ?? 1;
  }

  private async fetchMonthRates(month: MonthRef): Promise<Record<string, number>> {
    const year = month.year;
    const mm = String(month.month + 1).padStart(2, "0");
    // Try the first few days of the month to avoid gaps on holidays/weekends.
    for (let day = 1; day <= 5; day++) {
      const dd = String(day).padStart(2, "0");
      const url = `${CBR_BASE}/archive/${year}/${mm}/${dd}/daily_json.js`;
      const parsed = await this.tryFetchRates(url);
      if (parsed) return parsed;
    }

    // Fallback to the latest rate if the archive is missing.
    const fallback = await this.tryFetchRates(`${CBR_BASE}/daily_json.js`);
    if (fallback) return fallback;
    return { RUB: 1 };
  }

  private async tryFetchRates(url: string): Promise<Record<string, number> | null> {
    try {
      const res = await requestUrl({ url });
      if (res.status >= 400) return null;
      const data = res.json ?? JSON.parse(res.text);
      const rates: Record<string, number> = { RUB: 1 };
      if (data?.Valute) {
        Object.entries<any>(data.Valute).forEach(([code, info]) => {
          rates[code] = info.Value / info.Nominal;
        });
      }
      return rates;
    } catch (error) {
      console.warn("Failed to fetch CBR rates", error);
      return null;
    }
  }
}

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
    for (let i = 0; i < count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      result.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        key,
        label: d.toLocaleString(undefined, { month: "short", year: "numeric" }),
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
    const totals: MonthlyTotal[] = [];
    for (const month of months) {
      const breakdown: ExpenseBreakdown[] = [];
      let total = 0;

      for (const expense of this.settings.expenses) {
        if (!this.isExpenseActive(expense, month)) continue;
        const base = this.monthlyBaseAmount(expense);
        const rate = await this.rateService.getRateForMonth(month, expense.currency);
        const rub = base * rate;
        total += rub;
        breakdown.push({
          expenseId: expense.id,
          name: expense.name,
          currency: expense.currency.toUpperCase(),
          amount: base,
          rub,
          cadence: expense.cadence,
        });
      }

      totals.push({ month, totalRub: total, breakdown });
    }
    return totals;
  }
}

class ExpensesView extends ItemView {
  private lineChart?: echarts.ECharts;
  private pieChart?: echarts.ECharts;

  constructor(leaf: WorkspaceLeaf, private plugin: ExpensesPlugin) {
    super(leaf);
  }

  getViewType() {
    return EXPENSES_VIEW_TYPE;
  }

  getDisplayText() {
    return "Expenses";
  }

  async onOpen() {
    await this.render();
  }

  async render() {
    this.disposeCharts();

    const container = this.containerEl;
    container.empty();
    container.addClass("expenses-view");

    const months = this.plugin.getRecentMonths();
    const totals = await this.plugin.calculateMonthlyTotals(months);

    const heading = container.createEl("div", { cls: "expenses-header" });
    heading.createEl("h2", { text: "Расходы" });
    // heading.createEl("p", {
    //   text: "Суммы пересчитываются по курсу ЦБ РФ для каждого месяца.",
    //   cls: "expenses-subtitle",
    // });

    if (!this.plugin.settings.expenses.length) {
      heading.createEl("p", {
        text: "Добавьте расходы в настройках плагина, чтобы увидеть таблицу.",
      });
      return;
    }

    if (!totals.length) {
      container.createEl("p", { text: "Нет данных для выбранного периода." });
      return;
    }

    this.renderCharts(container, totals);
    const latest = totals[0];
    this.renderExpenseTable(container, latest);
    this.renderMonthlyTotals(container, totals);
  }

  onPaneMenu() {
    this.lineChart?.resize();
    this.pieChart?.resize();
  }

  private renderExpenseTable(container: HTMLElement, latest: MonthlyTotal) {
    container.createEl("h3", {
      text: `Ежемесячные расходы за ${latest.month.label}`,
    });
    const table = container.createEl("table", { cls: "expenses-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    ["Название", "Тип", "Сумма", `В рублях (${latest.month.label})`].forEach((name) => {
      headerRow.createEl("th", { text: name });
    });

    const tbody = table.createEl("tbody");
    latest.breakdown.forEach((entry) => {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: entry.name });
      row.createEl("td", {
        text: entry.cadence === "monthly" ? "Ежемесячный" : "Ежегодный",
      });
      row.createEl("td", {
        text: `${entry.amount.toFixed(2)} ${entry.currency}`,
      });
      row.createEl("td", { text: `${entry.rub.toFixed(2)} ₽` });
    });
  }

  private renderMonthlyTotals(container: HTMLElement, totals: MonthlyTotal[]) {
    container.createEl("h3", { text: "Итоговый расход по месяцам (₽)" });
    const table = container.createEl("table", { cls: "expenses-table monthly" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "Месяц" });
    headerRow.createEl("th", { text: "Сумма" });

    const tbody = table.createEl("tbody");
    totals.forEach((month) => {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: month.month.label });
      row.createEl("td", { text: `${month.totalRub.toFixed(2)} ₽` });
    });
  }

  private renderCharts(container: HTMLElement, totals: MonthlyTotal[]) {
    const charts = container.createDiv({ cls: "charts" });
    const lineBox = charts.createDiv({ cls: "chart echarts-card" });
    lineBox.createEl("h3", { text: "Динамика расходов (₽)" });
    const lineEl = lineBox.createDiv({ cls: "echart" });

    const pieBox = charts.createDiv({ cls: "chart echarts-card" });
    pieBox.createEl("h3", { text: `Структура расходов — ${totals[0].month.label}` });
    const pieEl = pieBox.createDiv({ cls: "echart" });

    this.drawLineChart(lineEl, totals);
    this.drawPieChart(pieEl, totals[0]);
  }

  private drawLineChart(el: HTMLElement, totals: MonthlyTotal[]) {
    this.lineChart?.dispose();
    this.lineChart = echarts.init(el);
    const ordered = [...totals].reverse();
    this.lineChart.setOption({
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: ordered.map((t) => t.month.label),
      },
      yAxis: { type: "value" },
      grid: { left: 50, right: 24, top: 40, bottom: 50 },
      series: [
        {
          type: "line",
          smooth: true,
          data: ordered.map((t) => Number(t.totalRub.toFixed(2))),
          areaStyle: { opacity: 0.12 },
          lineStyle: { width: 3 },
          symbol: "circle",
        },
      ],
    });
  }

  private drawPieChart(el: HTMLElement, month: MonthlyTotal) {
    this.pieChart?.dispose();
    this.pieChart = echarts.init(el);
    const data = month.breakdown.map((item) => ({
      name: `${item.name} (${item.currency})`,
      value: Number(item.rub.toFixed(2)),
    }));
    this.pieChart.setOption({
      tooltip: { trigger: "item", formatter: "{b}: {c} ₽ ({d}%)" },
      legend: {
        orient: "horizontal",
        bottom: 0,
        left: "center",
      },
      series: [
        {
          type: "pie",
          radius: ["40%", "65%"],
          center: ["50%", "45%"],
          data,
          label: { formatter: "{b}" },
        },
      ],
    });
  }

  private disposeCharts() {
    this.lineChart?.dispose();
    this.lineChart = undefined;
    this.pieChart?.dispose();
    this.pieChart = undefined;
  }

  async onClose() {
    this.disposeCharts();
  }

  onResize() {
    this.lineChart?.resize();
    this.pieChart?.resize();
  }
}

class ExpensesSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExpensesPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Расходы" });

    new Setting(containerEl)
      .setName("Сколько месяцев показывать")
      .setDesc("Используется для таблицы и графиков")
      .addSlider((slider) =>
        slider
          .setLimits(1, 12, 1)
          .setValue(this.plugin.settings.monthsToShow)
          .onChange(async (value) => {
            this.plugin.settings.monthsToShow = value;
            await this.plugin.saveSettings();
          }),
      );

    const listHeader = containerEl.createEl("div", { cls: "expenses-list-header" });
    listHeader.createEl("h3", { text: "Список расходов" });
    const addButton = listHeader.createEl("button", { text: "Добавить" });
    addButton.addEventListener("click", () => {
      new ExpenseModal(this.app, null, (expense) => this.upsertExpense(expense)).open();
    });

    const list = containerEl.createEl("div", { cls: "expenses-list" });
    this.plugin.settings.expenses.forEach((expense) => {
      const row = list.createEl("div", { cls: "expense-row" });
      row.createSpan({
        text: `${expense.name} — ${expense.amount} ${expense.currency.toUpperCase()} (${expense.cadence === "monthly" ? "ежемесячно" : "ежегодно"})`,
      });

      if (expense.startMonth) {
        row.createSpan({ text: ` • с ${expense.startMonth}`, cls: "start-month" });
      }

      const actions = row.createDiv({ cls: "expense-actions" });
      const editBtn = actions.createEl("button", { text: "Редактировать" });
      editBtn.addEventListener("click", () => {
        new ExpenseModal(this.app, expense, (updated) => this.upsertExpense(updated)).open();
      });

      const deleteBtn = actions.createEl("button", { text: "Удалить" });
      deleteBtn.addEventListener("click", async () => {
        this.plugin.settings.expenses = this.plugin.settings.expenses.filter(
          (item) => item.id !== expense.id,
        );
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }

  private async upsertExpense(expense: Expense) {
    const existingIndex = this.plugin.settings.expenses.findIndex((e) => e.id === expense.id);
    if (existingIndex >= 0) {
      this.plugin.settings.expenses[existingIndex] = expense;
    } else {
      this.plugin.settings.expenses.push(expense);
    }
    await this.plugin.saveSettings();
    this.display();
  }
}

class ExpenseModal extends Modal {
  private data: Expense;
  private onSubmit: (expense: Expense) => void;

  constructor(app: App, expense: Expense | null, onSubmit: (expense: Expense) => void) {
    super(app);
    this.onSubmit = onSubmit;
    this.data =
      expense ??
      ({
        id: crypto.randomUUID?.() ?? `${Date.now()}`,
        name: "",
        amount: 0,
        currency: "RUB",
        cadence: "monthly",
        startMonth: "",
      } satisfies Expense);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Расход" });

    new Setting(contentEl).setName("Название").addText((text) =>
      text.setValue(this.data.name).onChange((value) => (this.data.name = value)),
    );

    new Setting(contentEl).setName("Сумма").addText((text) =>
      text
        .setPlaceholder("1000")
        .setValue(String(this.data.amount || ""))
        .onChange((value) => {
          const num = Number(value);
          if (!Number.isNaN(num)) this.data.amount = num;
        }),
    );

    new Setting(contentEl).setName("Валюта (ISO)").addText((text) =>
      text
        .setPlaceholder("USD, EUR, RUB")
        .setValue(this.data.currency)
        .onChange((value) => (this.data.currency = value.toUpperCase())),
    );

    new Setting(contentEl)
      .setName("Тип")
      .setDesc("Ежемесячный или ежегодный")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("monthly", "Ежемесячный")
          .addOption("yearly", "Ежегодный")
          .setValue(this.data.cadence)
          .onChange((value) => (this.data.cadence = value as ExpenseCadence)),
      );

    new Setting(contentEl)
      .setName("Начало (YYYY-MM)")
      .setDesc("Необязательно. Расход учитывается начиная с этой даты.")
      .addText((text) =>
        text
          .setPlaceholder("2024-01")
          .setValue(this.data.startMonth ?? "")
          .onChange((value) => (this.data.startMonth = value.trim())),
      );

    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const submit = footer.createEl("button", { text: "Сохранить" });
    submit.addEventListener("click", () => {
      if (!this.data.name || !this.data.amount || !this.data.currency) {
        new Notice("Заполните название, сумму и валюту");
        return;
      }
      this.close();
      this.onSubmit(this.data);
    });
  }
}
