import { ItemView, WorkspaceLeaf } from "obsidian";
import * as echarts from "echarts";
import type ExpensesPlugin from "../main";
import { EXPENSES_VIEW_TYPE } from "../model/constants";
import type { MonthlyTotal } from "../model/MonthlyTotal";
import type { ExpenseBreakdown } from "../model/ExpenseBreakdown";
import type { MonthlyExpensesPageData } from "../model/MonthlyExpensesPageData";
import type { MonthlyExpensesPageFilters } from "../model/MonthlyExpensesPageFilters";
import { STRINGS } from "../model/translations";
import { ManualExpenseModal } from "./ManualExpenseModal";
import { MonthlySavingsModal } from "./MonthlySavingsModal";

type SortKey = "name" | "cadence" | "amount" | "baseValue";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;
type ViewPage = "dashboard" | "monthly";

export class ExpensesView extends ItemView {
  private waterfallChart?: echarts.ECharts;
  private pieChart?: echarts.ECharts;
  private monthlyExpensePieChart?: echarts.ECharts;
  private monthlySavingsGrowthChart?: echarts.ECharts;
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
  private currentPage: ViewPage = "dashboard";
  private monthlyPageFilters?: Partial<MonthlyExpensesPageFilters>;

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

    const strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en;
    this.cachedStrings = strings;

    if (this.currentPage === "monthly") {
      await this.renderMonthlyPage(container, strings);
      return;
    }

    await this.renderDashboardPage(container, strings);
  }

  onPaneMenu() {
    this.waterfallChart?.resize();
    this.pieChart?.resize();
    this.monthlyExpensePieChart?.resize();
    this.monthlySavingsGrowthChart?.resize();
  }

  async onClose() {
    this.disposeCharts();
  }

  onResize() {
    this.waterfallChart?.resize();
    this.pieChart?.resize();
    this.monthlyExpensePieChart?.resize();
    this.monthlySavingsGrowthChart?.resize();
  }

  private async renderDashboardPage(container: HTMLElement, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    const baseCurrency = (this.plugin.settings.baseCurrency ?? "RUB").toUpperCase();
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

    this.renderPageHeader(container, strings.heading, strings.subtitle, strings);

    if (!hasExpenses && !hasIncomes) {
      container.createEl("p", { text: strings.addExpensesHint });
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

  private async renderMonthlyPage(container: HTMLElement, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    const pageData = await this.plugin.buildMonthlyExpensesPageData(this.monthlyPageFilters);
    this.monthlyPageFilters = pageData.filters;

    this.renderPageHeader(container, strings.monthlyPageTitle, strings.monthlyPageSubtitle, strings);
    this.renderMonthlyPageToolbar(container, pageData, strings);
    this.renderMonthlyPageStatus(container, pageData, strings);
    this.renderMonthlyPageSummary(container, pageData, strings);
    this.renderMonthlyPageAnalytics(container, pageData, strings);
    this.renderMonthlyExpensesTable(container, pageData, strings);
    this.renderMonthlySavingsTable(container, pageData, strings);
  }

  private renderPageHeader(container: HTMLElement, title: string, subtitle: string, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    const heading = container.createEl("div", { cls: "expenses-header expenses-page-header" });
    const copy = heading.createDiv({ cls: "expenses-header-copy" });
    copy.createEl("h2", { text: title });
    copy.createEl("p", {
      text: subtitle,
      cls: "expenses-subtitle",
    });

    const nav = heading.createDiv({ cls: "expenses-page-nav" });
    const previousButton = nav.createEl("button", {
      text: "←",
      attr: { "aria-label": strings.previousPage, title: strings.previousPage },
    });
    previousButton.disabled = this.currentPage === "dashboard";
    previousButton.addEventListener("click", async () => {
      this.currentPage = "dashboard";
      await this.render();
    });

    const nextButton = nav.createEl("button", {
      text: "→",
      attr: { "aria-label": strings.nextPage, title: strings.nextPage },
    });
    nextButton.disabled = this.currentPage === "monthly";
    nextButton.addEventListener("click", async () => {
      this.currentPage = "monthly";
      this.monthlyPageFilters ??= this.plugin.getDefaultMonthlyExpensesFilters();
      await this.render();
    });
  }

  private renderMonthlyPageToolbar(container: HTMLElement, pageData: MonthlyExpensesPageData, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    const toolbar = container.createDiv({ cls: "monthly-page-toolbar chart" });
    const topRow = toolbar.createDiv({ cls: "monthly-page-toolbar-top" });
    const filtersRow = topRow.createDiv({ cls: "monthly-page-selectors" });

    const yearField = filtersRow.createDiv({ cls: "monthly-page-selector" });
    yearField.createEl("label", { text: strings.yearFilterLabel });
    const yearSelect = yearField.createEl("select");
    pageData.availableYears.forEach((year) => {
      const option = yearSelect.createEl("option", { text: String(year) });
      option.value = String(year);
    });
    yearSelect.value = String(pageData.filters.selectedYear);
    yearSelect.addEventListener("change", async () => {
      const selectedYear = Number(yearSelect.value);
      const selectedMonthKey = `${selectedYear}-${String(pageData.filters.selectedMonthIndex + 1).padStart(2, "0")}`;
      this.monthlyPageFilters = {
        ...pageData.filters,
        selectedYear,
        selectedMonthKey,
      };
      await this.render();
    });

    const monthField = filtersRow.createDiv({ cls: "monthly-page-selector" });
    monthField.createEl("label", { text: strings.monthFilterLabel });
    const monthSelect = monthField.createEl("select");
    pageData.availableMonths.forEach((monthKey) => {
      const option = monthSelect.createEl("option", { text: this.formatMonthKey(monthKey, strings.locale) });
      option.value = monthKey;
    });
    monthSelect.value = pageData.filters.selectedMonthKey;
    monthSelect.addEventListener("change", async () => {
      const selectedMonthKey = monthSelect.value;
      this.monthlyPageFilters = {
        ...pageData.filters,
        selectedYear: Number(selectedMonthKey.slice(0, 4)),
        selectedMonthIndex: Number(selectedMonthKey.slice(5, 7)) - 1,
        selectedMonthKey,
      };
      await this.render();
    });

    const categoriesSection = filtersRow.createDiv({ cls: "monthly-page-categories" });
    categoriesSection.createEl("label", { text: strings.categoriesFilterLabel });
    const categorySelect = categoriesSection.createEl("select");
    categorySelect.createEl("option", {
      text: strings.allCategoriesLabel,
      value: "",
    });
    pageData.categories.forEach((category) => {
      categorySelect.createEl("option", {
        text: category,
        value: category,
      });
    });
    const selectedCategory =
      pageData.filters.selectedCategories.length === 1 ? pageData.filters.selectedCategories[0] : "";
    categorySelect.value = selectedCategory;
    categorySelect.disabled = !pageData.categories.length;
    categorySelect.addEventListener("change", async () => {
      const value = categorySelect.value.trim();
      this.monthlyPageFilters = {
        ...pageData.filters,
        selectedCategories: value ? [value] : [],
      };
      await this.render();
    });

    const actions = topRow.createDiv({ cls: "monthly-page-actions" });
    const addExpenseButton = actions.createEl("button", { text: strings.addExpenseAction });
    addExpenseButton.addEventListener("click", () => {
      new ManualExpenseModal(
        this.app,
        null,
        async (expense) => {
          await this.plugin.upsertManualExpenseNote(expense);
          this.monthlyPageFilters = {
            ...pageData.filters,
            selectedYear: expense.year,
            selectedMonthIndex: expense.monthIndex,
            selectedMonthKey: expense.month,
          };
          await this.render();
        },
        strings,
        pageData.filters.selectedMonthKey,
        this.plugin.settings.manualExpenseCategories ?? [],
      ).open();
    });

    const addSavingsButton = actions.createEl("button", { text: strings.addSavingsAction });
    addSavingsButton.addEventListener("click", () => {
      new MonthlySavingsModal(
        this.app,
        pageData.snapshot,
        pageData.filters.selectedMonthKey,
        async (monthKey, balances) => {
          await this.plugin.mergeMonthlySavingsSnapshotBalances(monthKey, balances);
          this.monthlyPageFilters = {
            ...pageData.filters,
            selectedYear: Number(monthKey.slice(0, 4)),
            selectedMonthIndex: Number(monthKey.slice(5, 7)) - 1,
            selectedMonthKey: monthKey,
          };
          await this.render();
        },
        strings,
      ).open();
    });

    if (!pageData.categories.length) {
      const empty = categoriesSection.createSpan({ cls: "monthly-page-empty", text: strings.monthlyPageNoCategories });
      empty.ariaDisabled = "true";
      return;
    }
  }

  private renderMonthlyPageSummary(container: HTMLElement, pageData: MonthlyExpensesPageData, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    const baseCurrency = (this.plugin.settings.baseCurrency ?? "RUB").toUpperCase();
    const totalExpenses = pageData.categoryTotals.reduce((sum, item) => sum + item.baseAmount, 0);
    const summary = container.createDiv({ cls: "monthly-page-summary" });

    const expenseCard = summary.createDiv({ cls: "chart monthly-page-card" });
    expenseCard.createEl("div", { cls: "monthly-page-card-label", text: strings.monthlyPageTotalExpenses(baseCurrency) });
    expenseCard.createEl("strong", { text: `${totalExpenses.toFixed(2)} ${baseCurrency}` });

    const totalSavingsCard = summary.createDiv({ cls: "chart monthly-page-card" });
    totalSavingsCard.createEl("div", {
      cls: "monthly-page-card-label",
      text: strings.monthlyPageSavingsBaseTotalTitle(baseCurrency),
    });
    totalSavingsCard.createEl("strong", {
      text: pageData.savingsBaseTotal
        ? `${pageData.savingsBaseTotal.total.toFixed(2)} ${baseCurrency}`
        : `0.00 ${baseCurrency}`,
    });
  }

  private renderMonthlyPageStatus(container: HTMLElement, pageData: MonthlyExpensesPageData, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    const messages: string[] = [];

    if (pageData.diagnostics.invalidManualExpenseNotes > 0) {
      messages.push(strings.monthlyPageInvalidExpenseNotes(pageData.diagnostics.invalidManualExpenseNotes));
    }
    if (pageData.diagnostics.invalidMonthlySavingsNotes > 0) {
      messages.push(strings.monthlyPageInvalidSavingsNotes(pageData.diagnostics.invalidMonthlySavingsNotes));
    }
    if (pageData.diagnostics.duplicateManualExpenseIds.length > 0) {
      messages.push(strings.monthlyPageDuplicateExpenseNotes(pageData.diagnostics.duplicateManualExpenseIds.length));
    }
    if (pageData.diagnostics.duplicateSavingsMonths.length > 0) {
      messages.push(strings.monthlyPageDuplicateSavingsNotes(pageData.diagnostics.duplicateSavingsMonths.length));
    }

    const hasMonthData = pageData.categories.length > 0 || !!pageData.snapshot;
    if (!messages.length && hasMonthData) {
      return;
    }

    const status = container.createDiv({ cls: "monthly-page-status" });

    if (!hasMonthData) {
      const emptyCard = status.createDiv({ cls: "chart monthly-page-status-card monthly-page-empty-card" });
      emptyCard.createEl("h3", { text: strings.monthlyPageEmptyStateTitle });
      emptyCard.createEl("p", { text: strings.monthlyPageEmptyStateDescription });
    }

    if (messages.length) {
      const diagnosticsCard = status.createDiv({ cls: "chart monthly-page-status-card monthly-page-diagnostics-card" });
      diagnosticsCard.createEl("h3", { text: strings.monthlyPageDiagnosticsTitle });
      const list = diagnosticsCard.createEl("ul", { cls: "monthly-page-diagnostics-list" });
      messages.forEach((message) => {
        list.createEl("li", { text: message });
      });
    }
  }

  private renderMonthlyPageAnalytics(container: HTMLElement, pageData: MonthlyExpensesPageData, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    const analytics = container.createDiv({ cls: "monthly-page-analytics" });
    const textColor = getTextColor();
    const baseCurrency = (this.plugin.settings.baseCurrency ?? "RUB").toUpperCase();

    const expenseCard = analytics.createDiv({ cls: "chart echarts-card monthly-page-analytics-card" });
    expenseCard.createEl("h3", { text: strings.monthlyPageExpenseBreakdownTitle(baseCurrency) });
    if (!pageData.categoryTotals.length) {
      expenseCard.createEl("p", { text: strings.monthlyPageNoExpenseAnalytics, cls: "monthly-page-empty-state" });
    } else {
      const expenseChartEl = expenseCard.createDiv({ cls: "echart monthly-page-echart" });
      this.monthlyExpensePieChart?.dispose();
      this.monthlyExpensePieChart = echarts.init(expenseChartEl);
      this.monthlyExpensePieChart.setOption(
        this.getMonthlyExpenseCategoryPieOption(pageData, baseCurrency, textColor),
      );
    }

    const savingsCardsRow = analytics.createDiv({ cls: "monthly-page-savings-row" });

    const balancesCard = savingsCardsRow.createDiv({ cls: "chart monthly-page-analytics-card" });
    balancesCard.createEl("h3", { text: strings.monthlyPageSavingsBalancesTitle });
    this.renderMonthlySavingsBalances(balancesCard, pageData, strings);

    const totalCard = savingsCardsRow.createDiv({ cls: "chart monthly-page-analytics-card" });
    totalCard.createEl("h3", { text: strings.monthlyPageSavingsBaseTotalTitle(baseCurrency) });
    this.renderMonthlySavingsBaseTotal(totalCard, pageData, strings);

    const growthCard = analytics.createDiv({ cls: "chart echarts-card monthly-page-analytics-card monthly-page-growth-card" });
    growthCard.createEl("h3", { text: strings.monthlyPageSavingsGrowthTitle(baseCurrency) });
    if (!pageData.savingsGrowthSeries.length) {
      growthCard.createEl("p", { text: strings.monthlyPageNoSavingsAnalytics, cls: "monthly-page-empty-state" });
    } else {
      const growthChartEl = growthCard.createDiv({ cls: "echart monthly-page-echart monthly-page-growth-echart" });
      this.monthlySavingsGrowthChart?.dispose();
      this.monthlySavingsGrowthChart = echarts.init(growthChartEl);
      this.monthlySavingsGrowthChart.setOption(
        this.getMonthlySavingsGrowthOption(pageData, baseCurrency, textColor),
      );
    }
  }

  private renderMonthlySavingsBalances(container: HTMLElement, pageData: MonthlyExpensesPageData, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    if (!pageData.snapshot || !Object.keys(pageData.snapshot.balances).length) {
      container.createEl("p", { text: strings.monthlyPageNoSavingsAnalytics, cls: "monthly-page-empty-state" });
      return;
    }

    const list = container.createDiv({ cls: "monthly-page-balance-list" });
    Object.entries(pageData.snapshot.balances)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([currency, amount]) => {
        const row = list.createDiv({ cls: "monthly-page-balance-row" });
        row.createSpan({ cls: "monthly-page-balance-currency", text: currency.toUpperCase() });
        row.createSpan({ cls: "monthly-page-balance-amount", text: amount.toFixed(2) });
      });
  }

  private renderMonthlySavingsBaseTotal(container: HTMLElement, pageData: MonthlyExpensesPageData, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    const baseCurrency = (this.plugin.settings.baseCurrency ?? "RUB").toUpperCase();
    if (!pageData.savingsBaseTotal) {
      container.createEl("p", { text: strings.monthlyPageNoSavingsAnalytics, cls: "monthly-page-empty-state" });
      return;
    }

    const total = container.createDiv({ cls: "monthly-page-base-total" });
    total.createEl("strong", {
      text: `${pageData.savingsBaseTotal.total.toFixed(2)} ${baseCurrency}`,
    });

    const breakdown = container.createDiv({ cls: "monthly-page-converted-list" });
    pageData.savingsBaseTotal.convertedBalances.forEach((item) => {
      const row = breakdown.createDiv({ cls: "monthly-page-converted-row" });
      row.createSpan({
        cls: "monthly-page-converted-label",
        text: strings.monthlyPageConvertedFromLabel(item.currency, baseCurrency),
      });
      row.createSpan({
        cls: "monthly-page-converted-value",
        text: `${item.baseValue.toFixed(2)} ${baseCurrency}`,
      });
    });
  }

  private renderMonthlyExpensesTable(container: HTMLElement, pageData: MonthlyExpensesPageData, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    const section = container.createDiv({ cls: "monthly-page-section" });
    section.createEl("h3", { text: strings.monthlyPageExpensesTitle });

    if (!pageData.expenses.length) {
      section.createEl("p", { text: strings.monthlyPageNoExpenses });
      return;
    }

    const table = section.createEl("table", { cls: "expenses-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: strings.manualExpenseDate });
    headerRow.createEl("th", { text: strings.manualExpenseCategory });
    headerRow.createEl("th", { text: strings.amount });
    headerRow.createEl("th", { text: strings.currency });

    const tbody = table.createEl("tbody");
    pageData.expenses.forEach((expense) => {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: expense.date });
      row.createEl("td", { text: expense.category });
      row.createEl("td", { text: expense.amount.toFixed(2) });
      row.createEl("td", { text: expense.currency.toUpperCase() });
    });
  }

  private renderMonthlySavingsTable(container: HTMLElement, pageData: MonthlyExpensesPageData, strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en) {
    const section = container.createDiv({ cls: "monthly-page-section" });
    section.createEl("h3", { text: strings.monthlyPageSavingsTitle });

    if (!pageData.snapshot) {
      section.createEl("p", { text: strings.monthlyPageNoSavings });
      return;
    }

    const table = section.createEl("table", { cls: "expenses-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: strings.monthlySavingsCurrency });
    headerRow.createEl("th", { text: strings.monthlySavingsAmount });

    const tbody = table.createEl("tbody");
    Object.entries(pageData.snapshot.balances)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([currency, amount]) => {
        const row = tbody.createEl("tr");
        row.createEl("td", { text: currency });
        row.createEl("td", { text: amount.toFixed(2) });
      });
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
    this.monthlyExpensePieChart?.dispose();
    this.monthlyExpensePieChart = undefined;
    this.monthlySavingsGrowthChart?.dispose();
    this.monthlySavingsGrowthChart = undefined;
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

  private formatMonthKey(monthKey: string, locale: string) {
    const year = Number(monthKey.slice(0, 4));
    const monthIndex = Number(monthKey.slice(5, 7)) - 1;
    return new Date(year, monthIndex, 1).toLocaleString(locale, { month: "long", year: "numeric" });
  }

  private getMonthlyExpenseCategoryPieOption(
    pageData: MonthlyExpensesPageData,
    baseCurrency: string,
    textColor: string,
  ): echarts.EChartsOption {
    return {
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          const value = Number(params.value ?? 0);
          const percent = Number(params.percent ?? 0);
          const breakdownEntries = Object.entries(params.data?.currencyBreakdown ?? {})
            .map(([currency, amount]) => `${Number(amount).toFixed(2)} ${currency}`)
            .join(", ");
          return `${params.name}: ${value.toFixed(2)} ${baseCurrency} (${percent.toFixed(1)}%)${breakdownEntries ? `<br/>${breakdownEntries}` : ""}`;
        },
        textStyle: { color: "#111827" },
      },
      legend: {
        orient: "horizontal",
        bottom: 12,
        left: "center",
        textStyle: { color: textColor },
      },
      series: [
        {
          type: "pie",
          radius: ["38%", "68%"],
          top: 0,
          bottom: 72,
          data: pageData.categoryTotals.map((item) => ({
            name: item.category,
            value: Number(item.baseAmount.toFixed(2)),
            currencyBreakdown: item.currencyBreakdown,
          })),
          label: {
            color: textColor,
            formatter: ({ name, percent }: any) => `${name}\n${percent.toFixed(0)}%`,
          },
        },
      ],
    };
  }

  private getMonthlySavingsGrowthOption(
    pageData: MonthlyExpensesPageData,
    baseCurrency: string,
    textColor: string,
  ): echarts.EChartsOption {
    const labels = pageData.savingsGrowthSeries.map((item) => this.formatMonthKey(item.month, this.cachedStrings.locale));
    const totals = pageData.savingsGrowthSeries.map((item) => Number(item.total.toFixed(2)));

    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: any[]) => {
          const point = params[0];
          const index = point?.dataIndex ?? 0;
          const current = totals[index] ?? 0;
          const previous = index > 0 ? totals[index - 1] : 0;
          const delta = current - previous;
          return `${labels[index]}<br/>${current.toFixed(2)} ${baseCurrency}<br/>${this.cachedStrings.monthlyPageGrowthTooltipDelta}: ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} ${baseCurrency}`;
        },
        textStyle: { color: "#111827" },
      },
      grid: { left: 56, right: 24, top: 28, bottom: 56 },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: textColor, rotate: labels.length > 6 ? 30 : 0 },
        axisLine: { lineStyle: { color: textColor, opacity: 0.5 } },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: textColor,
          formatter: (value: number) => `${value.toFixed(0)} ${baseCurrency}`,
        },
        axisLine: { lineStyle: { color: textColor, opacity: 0.5 } },
        splitLine: { lineStyle: { color: textColor, opacity: 0.25 } },
      },
      series: [
        {
          type: "line",
          smooth: true,
          symbolSize: 8,
          data: totals,
          lineStyle: { width: 3, color: "#3b82f6" },
          itemStyle: { color: "#3b82f6" },
          areaStyle: {
            color: "rgba(59, 130, 246, 0.18)",
          },
        },
      ],
    };
  }
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

  applyToTotals(totals: MonthlyTotal[]) {
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
  return null;
}
