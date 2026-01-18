import { ItemView, WorkspaceLeaf } from "obsidian";
import * as echarts from "echarts";
import type ExpensesPlugin from "../main";
import { EXPENSES_VIEW_TYPE } from "../model/constants";
import type { MonthlyTotal } from "../model/MonthlyTotal";
import { STRINGS } from "../model/translations";

export class ExpensesView extends ItemView {
  private lineChart?: echarts.ECharts;
  private pieChart?: echarts.ECharts;

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
    const latest = totals[0];
    this.renderExpenseTable(container, latest, baseCurrency, strings);
    this.renderMonthlyTotals(container, totals, baseCurrency, strings);
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
    container.createEl("h3", {
      text: strings.monthlyExpensesTitle(latest.month.label),
    });
    const table = container.createEl("table", { cls: "expenses-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    [
      strings.tableHeaders.name,
      strings.tableHeaders.cadence,
      strings.tableHeaders.amount,
      strings.tableHeaders.converted(latest.month.label, baseCurrency),
    ].forEach((name) => {
      headerRow.createEl("th", { text: name });
    });

    const tbody = table.createEl("tbody");
    latest.breakdown.forEach((entry) => {
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
    const charts = container.createDiv({ cls: "charts" });
    const lineBox = charts.createDiv({ cls: "chart echarts-card" });
    lineBox.createEl("h3", {
      text: strings.trendTitle(this.plugin.settings.baseCurrency.toUpperCase()),
    });
    const lineEl = lineBox.createDiv({ cls: "echart" });

    const pieBox = charts.createDiv({ cls: "chart echarts-card" });
    pieBox.createEl("h3", { text: strings.pieTitle(totals[0].month.label) });
    const pieEl = pieBox.createDiv({ cls: "echart" });

    this.drawLineChart(lineEl, totals, textColor);
    this.drawPieChart(pieEl, totals[0], textColor);
  }

  private drawLineChart(el: HTMLElement, totals: MonthlyTotal[], textColor: string) {
    this.lineChart?.dispose();
    this.lineChart = echarts.init(el);
    const ordered = [...totals].reverse();
    this.lineChart.setOption({
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
    });
  }

  private drawPieChart(el: HTMLElement, month: MonthlyTotal, textColor: string) {
    this.pieChart?.dispose();
    this.pieChart = echarts.init(el);
    const data = month.breakdown.map((item) => ({
      name: `${item.name} (${item.currency})`,
      value: Number(item.baseValue.toFixed(2)),
    }));
    this.pieChart.setOption({
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)", textStyle: { color: textColor } },
      legend: {
        orient: "horizontal",
        bottom: 0,
        left: "center",
        textStyle: { color: textColor },
      },
      series: [
        {
          type: "pie",
          radius: ["40%", "65%"],
          center: ["50%", "45%"],
          data,
          label: { formatter: "{b}", color: textColor },
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

function getTextColor() {
  const style = getComputedStyle(document.body);
  const color = style.getPropertyValue("--text-normal")?.trim();
  return color || "#e5e7eb";
}
