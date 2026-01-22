import { ItemView, WorkspaceLeaf } from "obsidian";
import * as echarts from "echarts";
import type ExpensesPlugin from "../main";
import { EXPENSES_VIEW_TYPE } from "../model/constants";
import type { MonthlyTotal } from "../model/MonthlyTotal";
import type { ExpenseBreakdown } from "../model/ExpenseBreakdown";
import { STRINGS } from "../model/translations";

type SortKey = "name" | "cadence" | "amount" | "baseValue";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

export class ExpensesView extends ItemView {
  private waterfallChart?: echarts.ECharts;
  private pieChart?: echarts.ECharts;
  private pieLegendHandlerAttached = false;
  private expenseTableContainer?: HTMLElement;
  private incomeTableContainer?: HTMLElement;
  private totalsTableContainer?: HTMLElement;
  private cachedExpenseTotals: MonthlyTotal[] = [];
  private cachedLatestExpense?: MonthlyTotal;
  private cachedLatestIncome?: MonthlyTotal;
  private cachedBaseCurrency = "RUB";
  private cachedStrings = STRINGS.en;
  private textColor = "#e5e7eb";
  private filters = new ExpenseFilterController();
  private isSyncingLegendSelection = false;
  private expenseSort: SortState = null;
  private incomeSort: SortState = null;

  constructor(leaf: WorkspaceLeaf, private plugin: ExpensesPlugin) {
    super(leaf);
  }

  getViewType() {
    return EXPENSES_VIEW_TYPE;
  }

  getDisplayText() {
    const strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en;
    return strings.heading;
  }

  getIcon() {
    return "pie-chart";
  }

  async onOpen() {
    await this.render();
  }

  async render() {
    this.disposeCharts();

    const container = this.containerEl;
    container.empty();
    container.addClass("expenses-view");

    const baseCurrency = (this.plugin.settings.baseCurrency ?? "RUB").toUpperCase();
    const strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en;
    const months = this.plugin.getRecentMonths();
    const entries = await this.plugin.loadEntriesFromNotes();
    const hasExpenses = entries.expenses.length > 0;
    const hasIncomes = entries.incomes.length > 0;
    const expenseTotals = hasExpenses ? await this.plugin.calculateMonthlyTotals(months, entries.expenses) : [];
    const incomeTotals = hasIncomes ? await this.plugin.calculateMonthlyTotals(months, entries.incomes) : [];
    this.cachedExpenseTotals = expenseTotals;
    const filteredTotals = this.getFilteredExpenseTotals();
    this.cachedLatestExpense = filteredTotals[0];
    this.cachedLatestIncome = incomeTotals[0];
    this.cachedBaseCurrency = baseCurrency;
    this.cachedStrings = strings;

    const heading = container.createEl("div", { cls: "expenses-header" });
    heading.createEl("h2", { text: strings.heading });
    heading.createEl("p", {
      text: strings.subtitle,
      cls: "expenses-subtitle",
    });

    if (!hasExpenses && !hasIncomes) {
      heading.createEl("p", {
        text: strings.addExpensesHint,
      });
      return;
    }

    if (!expenseTotals.length && !incomeTotals.length) {
      container.createEl("p", { text: strings.noData });
      return;
    }

    if (hasExpenses) {
      this.renderCharts(container, expenseTotals, incomeTotals, baseCurrency, strings);
    }

    if (hasIncomes && this.cachedLatestIncome) {
      this.incomeTableContainer = container.createDiv({ cls: "income-table-container" });
      this.renderIncomeTable(this.incomeTableContainer, this.cachedLatestIncome, baseCurrency, strings);
    }

    if (hasExpenses && this.cachedLatestExpense) {
      this.expenseTableContainer = container.createDiv({ cls: "expense-table-container" });
      this.totalsTableContainer = container.createDiv({ cls: "totals-table-container" });
      this.renderExpenseTable(this.expenseTableContainer, this.cachedLatestExpense, baseCurrency, strings);
      this.renderMonthlyTotals(this.totalsTableContainer, filteredTotals, baseCurrency, strings);
    }
  }

  onPaneMenu() {
    this.waterfallChart?.resize();
    this.pieChart?.resize();
  }

  private renderExpenseTable(
    container: HTMLElement,
    latest: MonthlyTotal,
    baseCurrency: string,
    strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en,
  ) {
    container.empty();
    container.createEl("h3", {
      text: strings.monthlyExpensesTitle(latest.month.label),
    });
    const table = container.createEl("table", { cls: "expenses-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    const expenseHeaders: Array<{ key: SortKey; label: string }> = [
      { key: "name", label: strings.tableHeaders.name },
      { key: "cadence", label: strings.tableHeaders.cadence },
      { key: "amount", label: strings.tableHeaders.amount },
      { key: "baseValue", label: strings.tableHeaders.converted(latest.month.label, baseCurrency) },
    ];
    expenseHeaders.forEach(({ key, label }) => {
      const th = headerRow.createEl("th");
      th.createSpan({
        text: `${label} ${this.getSortIcon(this.expenseSort, key)}`.trim(),
      });
      th.style.cursor = "pointer";
      th.addEventListener("click", () => this.toggleExpenseSort(key));
    });

    const tbody = table.createEl("tbody");
    this.getSortedEntries(latest.breakdown, this.expenseSort).forEach((entry) => {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: entry.name });
      row.createEl("td", {
        text: entry.cadence === "monthly" ? strings.cadenceLabel.monthly : strings.cadenceLabel.yearly,
      });
      row.createEl("td", {
        text: `${entry.amount.toFixed(2)} ${entry.currency}`,
      });
      row.createEl("td", { text: `${entry.baseValue.toFixed(2)} ${baseCurrency}` });
    });
  }

  private renderIncomeTable(
    container: HTMLElement,
    latest: MonthlyTotal,
    baseCurrency: string,
    strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en,
  ) {
    container.empty();
    container.createEl("h3", {
      text: strings.monthlyIncomeTitle(latest.month.label),
    });
    const table = container.createEl("table", { cls: "expenses-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    const headers: Array<{ key: SortKey; label: string }> = [
      { key: "name", label: strings.tableHeaders.name },
      { key: "cadence", label: strings.tableHeaders.cadence },
      { key: "amount", label: strings.tableHeaders.amount },
      { key: "baseValue", label: strings.tableHeaders.converted(latest.month.label, baseCurrency) },
    ];

    headers.forEach(({ key, label }) => {
      const th = headerRow.createEl("th");
      th.createSpan({
        text: `${label} ${this.getSortIcon(this.incomeSort, key)}`.trim(),
      });
      th.style.cursor = "pointer";
      th.addEventListener("click", () => this.toggleIncomeSort(key));
    });

    const tbody = table.createEl("tbody");
    this.getSortedEntries(latest.breakdown, this.incomeSort).forEach((entry) => {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: entry.name });
      row.createEl("td", {
        text: entry.cadence === "monthly" ? strings.cadenceLabel.monthly : strings.cadenceLabel.yearly,
      });
      row.createEl("td", {
        text: `${entry.amount.toFixed(2)} ${entry.currency}`,
      });
      row.createEl("td", { text: `${entry.baseValue.toFixed(2)} ${baseCurrency}` });
    });
  }

  private renderMonthlyTotals(
    container: HTMLElement,
    totals: MonthlyTotal[],
    baseCurrency: string,
    strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en,
  ) {
    container.empty();
    container.createEl("h3", { text: strings.totalsTitle(baseCurrency) });
    const table = container.createEl("table", { cls: "expenses-table monthly" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: strings.month });
    headerRow.createEl("th", { text: strings.total });

    const tbody = table.createEl("tbody");
    totals.forEach((month) => {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: month.month.label });
      row.createEl("td", { text: `${month.totalBase.toFixed(2)} ${baseCurrency}` });
    });
  }

  private renderCharts(
    container: HTMLElement,
    expenseTotals: MonthlyTotal[],
    incomeTotals: MonthlyTotal[],
    baseCurrency: string,
    strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en,
  ) {
    const textColor = getTextColor();
    this.textColor = textColor;
    const charts = container.createDiv({ cls: "charts" });
    const waterfallBox = charts.createDiv({ cls: "chart echarts-card" });
    waterfallBox.createEl("h3", {
      text: strings.trendTitle(baseCurrency),
    });
    const waterfallEl = waterfallBox.createDiv({ cls: "echart" });

    const pieBox = charts.createDiv({ cls: "chart echarts-card" });
    pieBox.createEl("h3", { text: strings.pieTitle(expenseTotals[0].month.label) });
    const pieEl = pieBox.createDiv({ cls: "echart" });

    const filteredTotals = this.getFilteredExpenseTotals();
    this.drawWaterfallChart(waterfallEl, filteredTotals[0], incomeTotals[0], textColor);
    this.drawPieChart(pieEl, expenseTotals[0], textColor);
  }

  private drawWaterfallChart(
    el: HTMLElement,
    expenseTotal: MonthlyTotal | undefined,
    incomeTotal: MonthlyTotal | undefined,
    textColor: string,
  ) {
    this.waterfallChart?.dispose();
    this.waterfallChart = echarts.init(el);
    this.waterfallChart.setOption(this.getWaterfallChartOption(expenseTotal, incomeTotal, textColor));
  }

  private drawPieChart(el: HTMLElement, month: MonthlyTotal, textColor: string) {
    this.pieChart?.dispose();
    this.pieChart = echarts.init(el);
    this.pieChart.setOption(this.getPieChartOption(month, textColor));
    this.attachPieLegendHandler();
  }

  private disposeCharts() {
    this.waterfallChart?.dispose();
    this.waterfallChart = undefined;
    if (this.pieChart && this.pieLegendHandlerAttached) {
      this.pieChart.off("legendselectchanged", this.handlePieLegendChange);
      this.pieLegendHandlerAttached = false;
    }
    this.pieChart?.dispose();
    this.pieChart = undefined;
  }

  async onClose() {
    this.disposeCharts();
  }

  onResize() {
    this.waterfallChart?.resize();
    this.pieChart?.resize();
  }

  private toggleExpenseSort(key: SortKey) {
    this.expenseSort = nextSortState(this.expenseSort, key);
    if (this.cachedLatestExpense && this.expenseTableContainer) {
      this.renderExpenseTable(
        this.expenseTableContainer,
        this.cachedLatestExpense,
        this.cachedBaseCurrency,
        this.cachedStrings,
      );
    }
  }

  private toggleIncomeSort(key: SortKey) {
    this.incomeSort = nextSortState(this.incomeSort, key);
    if (this.cachedLatestIncome && this.incomeTableContainer) {
      this.renderIncomeTable(
        this.incomeTableContainer,
        this.cachedLatestIncome,
        this.cachedBaseCurrency,
        this.cachedStrings,
      );
    }
  }

  private getSortedEntries(items: MonthlyTotal["breakdown"], state: SortState) {
    if (!state) return [...items];
    const { key, dir } = state;
    return [...items].sort((a, b) => compareValues(a[key], b[key], dir));
  }

  private getSortIcon(state: SortState, key: SortKey) {
    if (!state || state.key !== key) return "⇅";
    return state.dir === "asc" ? "▲" : "▼";
  }

  private updateFilteredView() {
    if (!this.cachedExpenseTotals.length) return;
    const filteredTotals = this.getFilteredExpenseTotals();
    this.cachedLatestExpense = filteredTotals[0];
    if (this.expenseTableContainer && this.cachedLatestExpense) {
      this.renderExpenseTable(
        this.expenseTableContainer,
        this.cachedLatestExpense,
        this.cachedBaseCurrency,
        this.cachedStrings,
      );
    }
    if (this.totalsTableContainer) {
      this.renderMonthlyTotals(this.totalsTableContainer, filteredTotals, this.cachedBaseCurrency, this.cachedStrings);
    }
    this.updateWaterfallChart(filteredTotals[0], this.cachedLatestIncome);
    if (this.cachedExpenseTotals[0]) {
      this.updatePieChart(this.cachedExpenseTotals[0], this.textColor);
    }
  }

  private updateWaterfallChart(expenseTotal?: MonthlyTotal, incomeTotal?: MonthlyTotal) {
    if (!this.waterfallChart) return;
    this.waterfallChart.setOption(
      this.getWaterfallChartOption(expenseTotal, incomeTotal, this.textColor),
      true,
    );
  }

  private updatePieChart(month: MonthlyTotal, textColor = this.textColor) {
    if (!this.pieChart) return;
    this.isSyncingLegendSelection = true;
    try {
      this.pieChart.setOption(this.getPieChartOption(month, textColor), true);
    } finally {
      this.isSyncingLegendSelection = false;
    }
  }

  private getFilteredExpenseTotals() {
    if (!this.cachedExpenseTotals.length) return [];
    return this.filters.applyToTotals(this.cachedExpenseTotals);
  }

  private getWaterfallChartOption(
    expenseTotal: MonthlyTotal | undefined,
    incomeTotal: MonthlyTotal | undefined,
    textColor: string,
  ): echarts.EChartsOption {
    const baseCurrency = this.plugin.settings.baseCurrency.toUpperCase();
    const incomeValue = Number((incomeTotal?.totalBase ?? 0).toFixed(2));
    const expenseValue = Number((expenseTotal?.totalBase ?? 0).toFixed(2));
    const balanceValue = Number((incomeValue - expenseValue).toFixed(2));
    const steps = [incomeValue, -expenseValue, balanceValue];
    let cumulative = 0;
    const helperData = steps.map((value) => {
      const start = cumulative;
      cumulative += value;
      return start;
    });
    const labels = [
      this.cachedStrings.waterfallLabels.income,
      this.cachedStrings.waterfallLabels.expense,
      this.cachedStrings.waterfallLabels.balance,
    ];
    const colors = ["#22c55e", "#ef4444", "#3b82f6"];

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: any[]) => {
          const bar = params.find((p) => p.seriesName === "value") ?? params[1] ?? params[0];
          const value = bar?.data?.value ?? bar?.value ?? 0;
          const name = bar?.name ?? "";
          const formatted = `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(2)}`;
          let suffix = "";
          if ((name === labels[1] || name === labels[2]) && incomeValue !== 0) {
            const percent = Math.abs((value / incomeValue) * 100);
            suffix = ` (${percent.toFixed(1)}% ${this.cachedStrings.ofIncome})`;
          }
          return `${name}: ${baseCurrency} ${formatted}${suffix}`;
        },
        textStyle: { color: "#111827" },
      },
      grid: { left: 50, right: 24, top: 40, bottom: 50 },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: textColor },
        axisLine: { lineStyle: { color: textColor, opacity: 0.5 } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor },
        axisLine: { lineStyle: { color: textColor, opacity: 0.5 } },
        splitLine: { lineStyle: { color: textColor, opacity: 0.3 } },
      },
      series: [
        {
          name: "offset",
          type: "bar",
          stack: "total",
          itemStyle: { color: "transparent" },
          emphasis: { disabled: true },
          data: helperData,
        },
        {
          name: "value",
          type: "bar",
          stack: "total",
          label: {
            show: true,
            position: "inside",
            formatter: ({ value }: any) => `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(0)}`,
          },
          data: steps.map((value, index) => ({
            value,
            itemStyle: { color: colors[index] },
            name: labels[index],
          })),
        },
      ],
    };
  }

  private getPieChartOption(month: MonthlyTotal, textColor: string): echarts.EChartsOption {
    const slices = this.getPieSeriesData(month);
    const legendNames = slices.reduce<Record<string, string>>((acc, slice) => {
      acc[slice.name] = slice.displayName;
      return acc;
    }, {});
    const legendSelection = this.getLegendSelectionState(month.breakdown);
    const baseCurrency = this.plugin.settings.baseCurrency.toUpperCase();

    return {
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          const name = params.data?.displayName ?? params.name;
          const value = params.value ?? 0;
          const percent = params.percent ?? 0;
          return `${name}: ${baseCurrency} ${value} (${percent}%)`;
        },
        textStyle: { color: "#111827" },
      },
      legend: {
        orient: "horizontal",
        bottom: 12,
        left: "center",
        padding: [8, 0, 0, 0],
        textStyle: { color: textColor },
        formatter: (name: string) => legendNames[name] ?? name,
        selected: legendSelection,
      },
      series: [
        {
          type: "pie",
          radius: ["40%", "65%"],
          top: 0,
          bottom: 80,
          data: slices,
          label: {
            formatter: ({ data }: any) => data?.displayName ?? "",
            color: textColor,
          },
        },
      ],
    };
  }

  private getPieSeriesData(month: MonthlyTotal) {
    return month.breakdown
      .sort((a, b) => b.baseValue - a.baseValue)
      .map((item) => ({
        name: item.expenseId,
        value: Number(item.baseValue.toFixed(2)),
        displayName: item.name,
      }));
  }

  private getLegendSelectionState(breakdown: ExpenseBreakdown[]): Record<string, boolean> {
    const selection: Record<string, boolean> = {};
    breakdown.forEach((entry) => {
      if (selection[entry.expenseId] === undefined) {
        selection[entry.expenseId] = this.filters.passes(entry);
      }
    });
    return selection;
  }

  private attachPieLegendHandler() {
    if (!this.pieChart) return;
    if (this.pieLegendHandlerAttached) {
      this.pieChart.off("legendselectchanged", this.handlePieLegendChange);
    }
    this.pieChart.on("legendselectchanged", this.handlePieLegendChange);
    this.pieLegendHandlerAttached = true;
  }

  private handlePieLegendChange = (event: LegendSelectChangedEvent) => {
    if (this.isSyncingLegendSelection) return;
    const selectedIds = new Set<string>();
    const allIds = Object.keys(event.selected ?? {});
    Object.entries(event.selected ?? {}).forEach(([id, isSelected]) => {
      if (isSelected) selectedIds.add(id);
    });
    const filterId = "pie-legend-selection";
    if (!allIds.length) return;
    if (selectedIds.size === allIds.length) {
      this.filters.remove(filterId);
    } else {
      this.filters.upsert({
        id: filterId,
        predicate: (entry) => selectedIds.has(entry.expenseId),
      });
    }
    this.updateFilteredView();
  };
}

type LegendSelectChangedEvent = {
  selected: Record<string, boolean>;
};

type ExpenseFilter = {
  id: string;
  predicate: (entry: ExpenseBreakdown) => boolean;
};

class ExpenseFilterController {
  private filters = new Map<string, ExpenseFilter>();

  upsert(filter: ExpenseFilter) {
    this.filters.set(filter.id, filter);
  }

  remove(id: string) {
    this.filters.delete(id);
  }

  passes(entry: ExpenseBreakdown) {
    for (const filter of this.filters.values()) {
      if (!filter.predicate(entry)) {
        return false;
      }
    }
    return true;
  }

  applyToTotals(totals: MonthlyTotal[]): MonthlyTotal[] {
    return totals.map((total) => {
      const breakdown = total.breakdown.filter((entry) => this.passes(entry));
      const totalBase = breakdown.reduce((sum, item) => sum + item.baseValue, 0);
      return { ...total, breakdown, totalBase };
    });
  }
}

function getTextColor() {
  const style = getComputedStyle(document.body);
  const color = style.getPropertyValue("--text-normal")?.trim();
  return color || "#e5e7eb";
}

function compareValues(a: string | number, b: string | number, dir: "asc" | "desc") {
  let result = 0;
  if (typeof a === "number" && typeof b === "number") {
    result = a - b;
  } else {
    result = String(a).localeCompare(String(b), undefined, { numeric: true });
  }
  return dir === "asc" ? result : -result;
}

function nextSortState<T extends string>(
  current: { key: T; dir: "asc" | "desc" } | null,
  key: T,
): { key: T; dir: "asc" | "desc" } | null {
  if (!current || current.key !== key) {
    return { key, dir: "asc" };
  }
  if (current.dir === "asc") {
    return { key, dir: "desc" };
  }
  // reset to no sort
  return null;
}
