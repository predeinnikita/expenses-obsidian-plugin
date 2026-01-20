import { ItemView, WorkspaceLeaf } from "obsidian";
import * as echarts from "echarts";
import type ExpensesPlugin from "../main";
import { EXPENSES_VIEW_TYPE } from "../model/constants";
import type { MonthlyTotal } from "../model/MonthlyTotal";
import type { ExpenseBreakdown } from "../model/ExpenseBreakdown";
import { STRINGS } from "../model/translations";

export class ExpensesView extends ItemView {
  private lineChart?: echarts.ECharts;
  private pieChart?: echarts.ECharts;
  private pieLegendHandlerAttached = false;
  private expenseTableContainer?: HTMLElement;
  private totalsTableContainer?: HTMLElement;
  private cachedTotals: MonthlyTotal[] = [];
  private cachedLatest?: MonthlyTotal;
  private cachedBaseCurrency = "RUB";
  private cachedStrings = STRINGS.en;
  private textColor = "#e5e7eb";
  private filters = new ExpenseFilterController();
  private isSyncingLegendSelection = false;
  private expenseSort: { key: "name" | "cadence" | "amount" | "baseValue"; dir: "asc" | "desc" } | null =
    null;

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
    const totals = await this.plugin.calculateMonthlyTotals(months);
    this.cachedTotals = totals;
    const filteredTotals = this.getFilteredTotals();
    this.cachedLatest = filteredTotals[0];
    this.cachedBaseCurrency = baseCurrency;
    this.cachedStrings = strings;

    const heading = container.createEl("div", { cls: "expenses-header" });
    heading.createEl("h2", { text: strings.heading });
    heading.createEl("p", {
      text: strings.subtitle,
      cls: "expenses-subtitle",
    });

    if (!this.plugin.settings.expenses.length) {
      heading.createEl("p", {
        text: strings.addExpensesHint,
      });
      return;
    }

    if (!totals.length) {
      container.createEl("p", { text: strings.noData });
      return;
    }

    this.renderCharts(container, totals, strings);
    this.expenseTableContainer = container.createDiv({ cls: "expense-table-container" });
    this.totalsTableContainer = container.createDiv({ cls: "totals-table-container" });
    const latest = filteredTotals[0];
    this.renderExpenseTable(this.expenseTableContainer, latest, baseCurrency, strings);
    this.renderMonthlyTotals(this.totalsTableContainer, filteredTotals, baseCurrency, strings);
  }

  onPaneMenu() {
    this.lineChart?.resize();
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
    const expenseHeaders: Array<{ key: "name" | "cadence" | "amount" | "baseValue"; label: string }> = [
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
    this.getSortedExpenses(latest.breakdown).forEach((entry) => {
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
    totals: MonthlyTotal[],
    strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en,
  ) {
    const textColor = getTextColor();
    this.textColor = textColor;
    const charts = container.createDiv({ cls: "charts" });
    const lineBox = charts.createDiv({ cls: "chart echarts-card" });
    lineBox.createEl("h3", {
      text: strings.trendTitle(this.plugin.settings.baseCurrency.toUpperCase()),
    });
    const lineEl = lineBox.createDiv({ cls: "echart" });

    const pieBox = charts.createDiv({ cls: "chart echarts-card" });
    pieBox.createEl("h3", { text: strings.pieTitle(totals[0].month.label) });
    const pieEl = pieBox.createDiv({ cls: "echart" });

    const filteredTotals = this.getFilteredTotals();
    this.drawLineChart(lineEl, filteredTotals, textColor);
    this.drawPieChart(pieEl, totals[0], textColor);
  }

  private drawLineChart(el: HTMLElement, totals: MonthlyTotal[], textColor: string) {
    this.lineChart = echarts.init(el);
    this.lineChart.setOption(this.getLineChartOption(totals, textColor));
  }

  private drawPieChart(el: HTMLElement, month: MonthlyTotal, textColor: string) {
    this.pieChart?.dispose();
    this.pieChart = echarts.init(el);
    this.pieChart.setOption(this.getPieChartOption(month, textColor));
    this.attachPieLegendHandler();
  }

  private disposeCharts() {
    this.lineChart?.dispose();
    this.lineChart = undefined;
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
    this.lineChart?.resize();
    this.pieChart?.resize();
  }

  private toggleExpenseSort(key: "name" | "cadence" | "amount" | "baseValue") {
    this.expenseSort = nextSortState(this.expenseSort, key);
    if (this.cachedLatest && this.expenseTableContainer) {
      this.renderExpenseTable(this.expenseTableContainer, this.cachedLatest, this.cachedBaseCurrency, this.cachedStrings);
    }
  }

  private getSortedExpenses(items: MonthlyTotal["breakdown"]) {
    if (!this.expenseSort) return [...items];
    const { key, dir } = this.expenseSort;
    return [...items].sort((a, b) => compareValues(a[key], b[key], dir));
  }

  private getSortIcon<T extends string>(state: { key: T; dir: "asc" | "desc" } | null, key: T) {
    if (!state || state.key !== key) return "⇅";
    return state.dir === "asc" ? "▲" : "▼";
  }

  private updateFilteredView() {
    if (!this.cachedTotals.length) return;
    const filteredTotals = this.getFilteredTotals();
    this.cachedLatest = filteredTotals[0];
    if (this.expenseTableContainer && this.cachedLatest) {
      this.renderExpenseTable(
        this.expenseTableContainer,
        this.cachedLatest,
        this.cachedBaseCurrency,
        this.cachedStrings,
      );
    }
    if (this.totalsTableContainer) {
      this.renderMonthlyTotals(this.totalsTableContainer, filteredTotals, this.cachedBaseCurrency, this.cachedStrings);
    }
    this.updateLineChart(filteredTotals);
    if (this.cachedTotals[0]) {
      this.updatePieChart(this.cachedTotals[0], this.textColor);
    }
  }

  private updateLineChart(totals: MonthlyTotal[]) {
    if (!this.lineChart) return;
    this.lineChart.setOption(this.getLineChartOption(totals, this.textColor), true);
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

  private getFilteredTotals() {
    if (!this.cachedTotals.length) return [];
    return this.filters.applyToTotals(this.cachedTotals);
  }

  private getLineChartOption(totals: MonthlyTotal[], textColor: string): echarts.EChartsOption {
    const ordered = [...totals].reverse();
    return {
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: ordered.map((t) => t.month.label),
        axisLabel: { color: textColor },
        axisLine: { lineStyle: { color: textColor, opacity: 0.5 } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor },
        axisLine: { lineStyle: { color: textColor, opacity: 0.5 } },
        splitLine: { lineStyle: { color: textColor, opacity: 0.3 } },
      },
      grid: { left: 50, right: 24, top: 40, bottom: 50 },
      series: [
        {
          type: "line",
          smooth: true,
          data: ordered.map((t) => Number(t.totalBase.toFixed(2))),
          areaStyle: { opacity: 0.12 },
          lineStyle: { width: 3 },
          symbol: "circle",
          itemStyle: { color: "#3b82f6" },
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
        textStyle: { color: textColor },
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
