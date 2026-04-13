import { Notice, Plugin, WorkspaceLeaf, normalizePath, TFile, TFolder } from "obsidian";
import { ExpensesView, ExpensesSettingTab } from "./components";
import { CbrRateService } from "./services";
import {
  STRINGS,
  DEFAULT_SETTINGS,
  EXPENSES_VIEW_TYPE,
  Expense,
  ExpensesSettings,
  ManualExpense,
  MonthlyTotal,
  MonthlySavingsSnapshot,
  ExpenseBreakdown,
  MonthRef,
  MonthlyExpenseCategoryTotal,
  MonthlySavingsBaseTotal,
  MonthlyExpensesPageFilters,
  MonthlyExpensesPageData,
} from "./model";
import type { ExpenseCadence } from "./model/ExpenseCadence";

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
    this.settings = {
      monthsToShow: loaded?.monthsToShow ?? DEFAULT_SETTINGS.monthsToShow,
      baseCurrency: loaded?.baseCurrency ?? DEFAULT_SETTINGS.baseCurrency,
      language: loaded?.language ?? DEFAULT_SETTINGS.language,
      notesPath: loaded?.notesPath ?? DEFAULT_SETTINGS.notesPath,
    };
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

  async upsertEntryNote(entry: Expense, type: "expense" | "income", previousEntry?: Expense) {
    const notesPath = this.normalizeNotesPath();
    if (notesPath) {
      const ok = await this.ensureFolder(notesPath);
      if (!ok) return;
    }

    const path = this.getEntryNotePath(entry, type, notesPath);
    const content = this.buildEntryNoteContent(entry, type);
    const existing = this.app.vault.getAbstractFileByPath(path);

    try {
      let targetFile: TFile | null = null;
      if (previousEntry) {
        const previousPath = this.getEntryNotePath(previousEntry, type, notesPath);
        if (previousPath !== path) {
          const byId = await this.findEntryNoteById(entry.id, notesPath);
          const previousFile =
            byId ??
            (this.app.vault.getAbstractFileByPath(previousPath) instanceof TFile
              ? (this.app.vault.getAbstractFileByPath(previousPath) as TFile)
              : null);
          if (previousFile) {
            if (previousFile.path !== path) {
              await this.app.vault.rename(previousFile, path);
            }
            targetFile = previousFile;
          }
        }
      }
      if (!targetFile && existing instanceof TFile) {
        targetFile = existing;
      }
      if (targetFile) {
        await this.app.vault.modify(targetFile, content);
        return;
      }
      if (existing) {
        new Notice(`Cannot write note: ${path} is a folder`);
        return;
      }
      await this.app.vault.create(path, content);
    } catch (err) {
      console.error("[expenses] failed to save note", err);
      new Notice("Failed to save expense/income note. Check console for details.");
    }
  }

  async deleteEntryNote(entry: Expense, type: "expense" | "income") {
    const notesPath = this.normalizeNotesPath();
    const path = this.getEntryNotePath(entry, type, notesPath);
    try {
      const toDelete: TFile[] = [];
      const byId = await this.findEntryNoteById(entry.id, notesPath);
      if (byId) {
        toDelete.push(byId);
      }
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile && !toDelete.includes(existing)) {
        toDelete.push(existing);
      } else if (existing && !(existing instanceof TFile)) {
        new Notice(`Cannot delete note: ${path} is a folder`);
        return;
      }
      for (const file of toDelete) {
        await this.app.vault.delete(file);
      }
    } catch (err) {
      console.error("[expenses] failed to delete note", err);
      new Notice("Failed to delete expense/income note. Check console for details.");
    }
  }

  async upsertManualExpenseNote(expense: ManualExpense, previousExpense?: ManualExpense) {
    const notesPath = this.normalizeNotesPath();
    if (notesPath) {
      const ok = await this.ensureFolder(notesPath);
      if (!ok) return;
    }

    const path = this.getManualExpenseNotePath(expense, notesPath);
    const content = this.buildManualExpenseNoteContent(expense);
    const existing = this.app.vault.getAbstractFileByPath(path);

    try {
      let targetFile: TFile | null = null;
      if (previousExpense) {
        const previousPath = this.getManualExpenseNotePath(previousExpense, notesPath);
        if (previousPath !== path) {
          const byId = await this.findNoteById(expense.id, notesPath, "manual-expense");
          const previousFile =
            byId ??
            (this.app.vault.getAbstractFileByPath(previousPath) instanceof TFile
              ? (this.app.vault.getAbstractFileByPath(previousPath) as TFile)
              : null);
          if (previousFile) {
            if (previousFile.path !== path) {
              await this.app.vault.rename(previousFile, path);
            }
            targetFile = previousFile;
          }
        }
      }
      if (!targetFile && existing instanceof TFile) {
        targetFile = existing;
      }
      if (!targetFile) {
        targetFile = await this.findNoteById(expense.id, notesPath, "manual-expense");
      }
      if (targetFile) {
        await this.app.vault.modify(targetFile, content);
        return;
      }
      if (existing) {
        new Notice(`Cannot write note: ${path} is a folder`);
        return;
      }
      await this.app.vault.create(path, content);
    } catch (err) {
      console.error("[expenses] failed to save manual expense note", err);
      new Notice("Failed to save manual expense note. Check console for details.");
    }
  }

  async deleteManualExpenseNote(expense: ManualExpense) {
    const notesPath = this.normalizeNotesPath();
    const path = this.getManualExpenseNotePath(expense, notesPath);
    try {
      const toDelete: TFile[] = [];
      const byId = await this.findNoteById(expense.id, notesPath, "manual-expense");
      if (byId) {
        toDelete.push(byId);
      }
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile && !toDelete.includes(existing)) {
        toDelete.push(existing);
      } else if (existing && !(existing instanceof TFile)) {
        new Notice(`Cannot delete note: ${path} is a folder`);
        return;
      }
      for (const file of toDelete) {
        await this.app.vault.delete(file);
      }
    } catch (err) {
      console.error("[expenses] failed to delete manual expense note", err);
      new Notice("Failed to delete manual expense note. Check console for details.");
    }
  }

  async upsertMonthlySavingsSnapshotNote(
    snapshot: MonthlySavingsSnapshot,
    previousSnapshot?: MonthlySavingsSnapshot,
  ) {
    const notesPath = this.normalizeNotesPath();
    if (notesPath) {
      const ok = await this.ensureFolder(notesPath);
      if (!ok) return;
    }

    const normalizedSnapshot = this.normalizeMonthlySavingsSnapshot(snapshot);
    const path = this.getMonthlySavingsSnapshotNotePath(normalizedSnapshot.month, notesPath);
    const content = this.buildMonthlySavingsSnapshotNoteContent(normalizedSnapshot);
    const existing = this.app.vault.getAbstractFileByPath(path);

    try {
      let targetFile: TFile | null = null;
      if (previousSnapshot) {
        const previousPath = this.getMonthlySavingsSnapshotNotePath(previousSnapshot.month, notesPath);
        if (previousPath !== path) {
          const previousFile =
            (this.app.vault.getAbstractFileByPath(previousPath) instanceof TFile
              ? (this.app.vault.getAbstractFileByPath(previousPath) as TFile)
              : null) ?? (await this.findMonthlySavingsSnapshotNoteByMonth(previousSnapshot.month, notesPath));
          if (previousFile) {
            if (previousFile.path !== path) {
              await this.app.vault.rename(previousFile, path);
            }
            targetFile = previousFile;
          }
        }
      }
      if (!targetFile && existing instanceof TFile) {
        targetFile = existing;
      }
      if (!targetFile) {
        targetFile = await this.findMonthlySavingsSnapshotNoteByMonth(normalizedSnapshot.month, notesPath);
      }
      if (targetFile) {
        await this.app.vault.modify(targetFile, content);
        return;
      }
      if (existing) {
        new Notice(`Cannot write note: ${path} is a folder`);
        return;
      }
      await this.app.vault.create(path, content);
    } catch (err) {
      console.error("[expenses] failed to save monthly savings snapshot note", err);
      new Notice("Failed to save monthly savings snapshot note. Check console for details.");
    }
  }

  async mergeMonthlySavingsSnapshotBalances(monthKey: string, balances: Record<string, number>) {
    const normalizedMonth = this.normalizeFrontmatterMonth(monthKey);
    if (!normalizedMonth || !this.isValidMonthKey(normalizedMonth)) {
      throw new Error(`Invalid month key: ${monthKey}`);
    }

    const snapshots = await this.loadMonthlySavingsSnapshotsFromNotes();
    const existing = this.getMonthlySavingsSnapshot(normalizedMonth, snapshots);
    const mergedBalances = {
      ...(existing?.balances ?? {}),
      ...this.normalizeBalances(balances),
    };

    await this.upsertMonthlySavingsSnapshotNote({
      type: "monthly-savings-snapshot",
      month: normalizedMonth,
      year: Number(normalizedMonth.slice(0, 4)),
      monthIndex: Number(normalizedMonth.slice(5, 7)) - 1,
      balances: mergedBalances,
      notePath: existing?.notePath ?? this.getMonthlySavingsSnapshotNotePath(normalizedMonth, this.normalizeNotesPath()),
    }, existing);
  }

  async deleteMonthlySavingsSnapshotNote(monthKey: string) {
    const notesPath = this.normalizeNotesPath();
    const normalizedMonth = this.normalizeFrontmatterMonth(monthKey);
    if (!normalizedMonth || !this.isValidMonthKey(normalizedMonth)) {
      new Notice("Failed to delete savings snapshot note. Invalid month.");
      return;
    }

    const path = this.getMonthlySavingsSnapshotNotePath(normalizedMonth, notesPath);
    try {
      const toDelete: TFile[] = [];
      const byMonth = await this.findMonthlySavingsSnapshotNoteByMonth(normalizedMonth, notesPath);
      if (byMonth) {
        toDelete.push(byMonth);
      }
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile && !toDelete.includes(existing)) {
        toDelete.push(existing);
      } else if (existing && !(existing instanceof TFile)) {
        new Notice(`Cannot delete note: ${path} is a folder`);
        return;
      }
      for (const file of toDelete) {
        await this.app.vault.delete(file);
      }
    } catch (err) {
      console.error("[expenses] failed to delete monthly savings snapshot note", err);
      new Notice("Failed to delete monthly savings snapshot note. Check console for details.");
    }
  }

  getDefaultMonthlyExpensesFilters(now = new Date()): MonthlyExpensesPageFilters {
    const year = now.getFullYear();
    const monthIndex = now.getMonth();
    return {
      selectedYear: year,
      selectedMonthIndex: monthIndex,
      selectedMonthKey: this.buildMonthKey(year, monthIndex),
      selectedCategories: [],
    };
  }

  normalizeMonthlyExpensesFilters(
    filters: Partial<MonthlyExpensesPageFilters> | undefined,
    expenses: ManualExpense[],
    _snapshots: MonthlySavingsSnapshot[],
    now = new Date(),
  ): MonthlyExpensesPageFilters {
    const defaults = this.getDefaultMonthlyExpensesFilters(now);
    const selectedYear =
      typeof filters?.selectedYear === "number" && Number.isFinite(filters.selectedYear)
        ? filters.selectedYear
        : defaults.selectedYear;
    const selectedMonthIndexRaw =
      typeof filters?.selectedMonthIndex === "number" && Number.isInteger(filters.selectedMonthIndex)
        ? filters.selectedMonthIndex
        : defaults.selectedMonthIndex;
    const selectedMonthIndex = Math.min(11, Math.max(0, selectedMonthIndexRaw));

    let selectedMonthKey = typeof filters?.selectedMonthKey === "string" ? filters.selectedMonthKey.trim() : "";
    if (!this.isValidMonthKey(selectedMonthKey)) {
      selectedMonthKey = this.buildMonthKey(selectedYear, selectedMonthIndex);
    }

    const selectedPeriodExpenses = this.filterManualExpensesByMonth(expenses, selectedMonthKey);
    const availableCategories = this.extractCategoriesFromExpenses(selectedPeriodExpenses);
    const normalizedSelectedCategories = Array.isArray(filters?.selectedCategories)
      ? this.normalizeCategorySelection(filters?.selectedCategories, availableCategories)
      : [];

    return {
      selectedYear: Number(selectedMonthKey.slice(0, 4)),
      selectedMonthIndex: Number(selectedMonthKey.slice(5, 7)) - 1,
      selectedMonthKey,
      selectedCategories: normalizedSelectedCategories.length ? normalizedSelectedCategories : availableCategories,
    };
  }

  getAvailableExpenseYears(expenses: ManualExpense[], snapshots: MonthlySavingsSnapshot[]): number[] {
    const years = new Set<number>();
    expenses.forEach((expense) => years.add(expense.year));
    snapshots.forEach((snapshot) => years.add(snapshot.year));
    return [...years.values()].sort((left, right) => right - left);
  }

  getAvailableExpenseMonths(year: number, expenses: ManualExpense[], snapshots: MonthlySavingsSnapshot[]): string[] {
    const months = new Set<string>();
    expenses.forEach((expense) => {
      if (expense.year === year) {
        months.add(expense.month);
      }
    });
    snapshots.forEach((snapshot) => {
      if (snapshot.year === year) {
        months.add(snapshot.month);
      }
    });
    return [...months.values()].sort((left, right) => right.localeCompare(left));
  }

  filterManualExpensesByMonth(expenses: ManualExpense[], monthKey: string): ManualExpense[] {
    return expenses.filter((expense) => expense.month === monthKey);
  }

  filterManualExpensesByCategories(expenses: ManualExpense[], categories: string[]): ManualExpense[] {
    if (!categories.length) return [...expenses];
    const allowed = new Set(categories.map((category) => category.trim().toLocaleLowerCase()));
    return expenses.filter((expense) => allowed.has(expense.category.trim().toLocaleLowerCase()));
  }

  async calculateMonthlyExpenseCategoryTotals(
    expenses: ManualExpense[],
    monthKey: string,
    categories: string[],
  ): Promise<MonthlyExpenseCategoryTotal[]> {
    const filteredExpenses = this.filterManualExpensesByCategories(
      this.filterManualExpensesByMonth(expenses, monthKey),
      categories,
    );
    const totals = new Map<string, MonthlyExpenseCategoryTotal>();
    const monthRef = this.monthKeyToRef(monthKey);
    const baseCurrency = this.settings.baseCurrency?.toUpperCase() || "RUB";
    const baseRate = await this.rateService.getRateForMonth(monthRef, baseCurrency);

    for (const expense of filteredExpenses) {
      const categoryKey = expense.category.trim().toLocaleLowerCase();
      const currency = expense.currency.toUpperCase();
      const amount = expense.amount;
      const rate = await this.rateService.getRateForMonth(monthRef, currency);
      const rub = amount * rate;
      const baseAmount = baseCurrency === "RUB" ? rub : rub / baseRate;
      const current = totals.get(categoryKey) ?? {
        category: expense.category.trim(),
        amount: 0,
        currencyBreakdown: {},
        baseAmount: 0,
      };
      current.amount += amount;
      current.baseAmount += baseAmount;
      current.currencyBreakdown[currency] = (current.currencyBreakdown[currency] ?? 0) + amount;
      totals.set(categoryKey, current);
    }

    return [...totals.values()].sort((left, right) => right.baseAmount - left.baseAmount);
  }

  getMonthlySavingsSnapshot(
    monthKey: string,
    snapshots: MonthlySavingsSnapshot[],
  ): MonthlySavingsSnapshot | undefined {
    return snapshots.find((snapshot) => snapshot.month === monthKey);
  }

  async calculateMonthlySavingsBaseTotal(
    snapshot: MonthlySavingsSnapshot | undefined,
    baseCurrency: string,
  ): Promise<MonthlySavingsBaseTotal | undefined> {
    if (!snapshot) return undefined;
    const normalizedBaseCurrency = baseCurrency.toUpperCase();
    const monthRef = this.monthKeyToRef(snapshot.month);
    const baseRate = await this.rateService.getRateForMonth(monthRef, normalizedBaseCurrency);
    const convertedBalances: MonthlySavingsBaseTotal["convertedBalances"] = [];
    let total = 0;

    for (const [currencyRaw, amount] of Object.entries(snapshot.balances)) {
      const currency = currencyRaw.toUpperCase();
      const rate = await this.rateService.getRateForMonth(monthRef, currency);
      const rub = amount * rate;
      const baseValue = normalizedBaseCurrency === "RUB" ? rub : rub / baseRate;
      total += baseValue;
      convertedBalances.push({
        currency,
        amount,
        baseValue,
      });
    }

    convertedBalances.sort((left, right) => right.baseValue - left.baseValue);

    return {
      month: snapshot.month,
      baseCurrency: normalizedBaseCurrency,
      total,
      convertedBalances,
    };
  }

  async calculateSavingsGrowthSeries(
    snapshots: MonthlySavingsSnapshot[],
    baseCurrency: string,
  ): Promise<Array<{ month: string; total: number }>> {
    const sortedSnapshots = [...snapshots].sort((left, right) => left.month.localeCompare(right.month));
    const series: Array<{ month: string; total: number }> = [];

    for (const snapshot of sortedSnapshots) {
      const total = await this.calculateMonthlySavingsBaseTotal(snapshot, baseCurrency);
      series.push({
        month: snapshot.month,
        total: total?.total ?? 0,
      });
    }

    return series;
  }

  async buildMonthlyExpensesPageData(
    filters?: Partial<MonthlyExpensesPageFilters>,
    now = new Date(),
  ): Promise<MonthlyExpensesPageData> {
    const expenseLoad = await this.collectManualExpensesFromNotes();
    const snapshotLoad = await this.collectMonthlySavingsSnapshotsFromNotes();
    const expenses = expenseLoad.expenses;
    const snapshots = snapshotLoad.snapshots;
    const normalizedFilters = this.normalizeMonthlyExpensesFilters(filters, expenses, snapshots, now);
    const availableYears = this.getAvailableExpenseYears(expenses, snapshots);
    if (!availableYears.includes(normalizedFilters.selectedYear)) {
      availableYears.unshift(normalizedFilters.selectedYear);
      availableYears.sort((left, right) => right - left);
    }
    const availableMonths = this.getAvailableExpenseMonths(normalizedFilters.selectedYear, expenses, snapshots);
    if (!availableMonths.includes(normalizedFilters.selectedMonthKey)) {
      availableMonths.unshift(normalizedFilters.selectedMonthKey);
      availableMonths.sort((left, right) => right.localeCompare(left));
    }
    const expensesForMonth = this.filterManualExpensesByMonth(expenses, normalizedFilters.selectedMonthKey);
    const categories = this.extractCategoriesFromExpenses(expensesForMonth);
    const normalizedCategorySelection = this.normalizeCategorySelection(
      normalizedFilters.selectedCategories,
      categories,
    );
    const finalFilters: MonthlyExpensesPageFilters = {
      ...normalizedFilters,
      selectedCategories: normalizedCategorySelection.length ? normalizedCategorySelection : categories,
    };
    const filteredExpenses = this.filterManualExpensesByCategories(expensesForMonth, finalFilters.selectedCategories);
    const snapshot = this.getMonthlySavingsSnapshot(finalFilters.selectedMonthKey, snapshots);
    const baseCurrency = this.settings.baseCurrency?.toUpperCase() || "RUB";

    return {
      filters: finalFilters,
      expenses: filteredExpenses,
      categories,
      availableYears,
      availableMonths,
      categoryTotals: await this.calculateMonthlyExpenseCategoryTotals(expenses, finalFilters.selectedMonthKey, finalFilters.selectedCategories),
      snapshot,
      savingsBaseTotal: await this.calculateMonthlySavingsBaseTotal(snapshot, baseCurrency),
      diagnostics: {
        invalidManualExpenseNotes: expenseLoad.invalidCount,
        invalidMonthlySavingsNotes: snapshotLoad.invalidCount,
        duplicateManualExpenseIds: [...expenseLoad.duplicateIds],
        duplicateSavingsMonths: [...snapshotLoad.duplicateMonths],
      },
      savingsGrowthSeries: await this.calculateSavingsGrowthSeries(snapshots, baseCurrency),
    };
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

  async calculateMonthlyTotals(months: MonthRef[], items: Expense[]): Promise<MonthlyTotal[]> {
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

  async loadEntriesFromNotes(): Promise<{ expenses: Expense[]; incomes: Expense[] }> {
    const folder = this.normalizeNotesPath();
    const files = this.app.vault.getMarkdownFiles();
    const expenses = new Map<string, Expense>();
    const incomes = new Map<string, Expense>();

    for (const file of files) {
      if (folder && !file.path.startsWith(`${folder}/`)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;
      if (!frontmatter) continue;
      const type = frontmatter.type;
      if (type !== "expense" && type !== "income") continue;
      const entry = this.parseEntryFromFrontmatter(frontmatter, file);
      if (!entry) continue;
      if (type === "expense") {
        expenses.set(entry.id, entry);
      } else {
        incomes.set(entry.id, entry);
      }
    }

    return {
      expenses: [...expenses.values()],
      incomes: [...incomes.values()],
    };
  }

  async loadManualExpensesFromNotes(): Promise<ManualExpense[]> {
    const { expenses } = await this.collectManualExpensesFromNotes();
    return expenses;
  }

  async loadMonthlySavingsSnapshotsFromNotes(): Promise<MonthlySavingsSnapshot[]> {
    const { snapshots } = await this.collectMonthlySavingsSnapshotsFromNotes();
    return snapshots;
  }

  async loadMonthlyExpenseCategories(): Promise<string[]> {
    const expenses = await this.loadManualExpensesFromNotes();
    const labels = new Map<string, string>();

    for (const expense of expenses) {
      const normalized = expense.category.trim().toLocaleLowerCase();
      if (!normalized || labels.has(normalized)) continue;
      labels.set(normalized, expense.category.trim());
    }

    return [...labels.values()].sort((left, right) => left.localeCompare(right));
  }

  private normalizeNotesPath(): string {
    const raw = this.settings.notesPath?.trim() ?? "";
    return raw ? normalizePath(raw) : "";
  }

  private getEntryNotePath(entry: Expense, _type: "expense" | "income", folder: string): string {
    const safeName = this.sanitizeFileName(entry.name);
    const fileName = `${safeName}.md`;
    return folder ? normalizePath(`${folder}/${fileName}`) : fileName;
  }

  private getManualExpenseNotePath(expense: ManualExpense, folder: string): string {
    const categorySlug = this.slugifyPathPart(expense.category);
    const safeId = this.slugifyPathPart(expense.id);
    const fileName = `expense-${expense.date}-${categorySlug}-${safeId}.md`;
    return folder ? normalizePath(`${folder}/${fileName}`) : fileName;
  }

  private getMonthlySavingsSnapshotNotePath(monthKey: string, folder: string): string {
    const fileName = `savings-${monthKey}.md`;
    return folder ? normalizePath(`${folder}/${fileName}`) : fileName;
  }

  private buildEntryNoteContent(entry: Expense, type: "expense" | "income"): string {
    const currency = entry.currency.toUpperCase();
    const lines: string[] = [
      "---",
      `type: ${type}`,
      `id: ${entry.id}`,
      `name: ${JSON.stringify(entry.name)}`,
      `amount: ${entry.amount}`,
      `currency: ${currency}`,
      `cadence: ${entry.cadence}`,
    ];
    if (entry.startMonth) {
      lines.push(`start: ${entry.startMonth}`);
    }
    lines.push("---", "", `# ${entry.name}`, "", `- amount: ${entry.amount} ${currency}`, `- cadence: ${entry.cadence}`);
    if (entry.startMonth) {
      lines.push(`- start: ${entry.startMonth}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  private buildManualExpenseNoteContent(expense: ManualExpense): string {
    const currency = expense.currency.toUpperCase();
    const lines: string[] = [
      "---",
      "type: manual-expense",
      `id: ${JSON.stringify(expense.id)}`,
      `date: ${JSON.stringify(expense.date)}`,
      `category: ${JSON.stringify(expense.category)}`,
      `amount: ${expense.amount}`,
      `currency: ${currency}`,
      "---",
      "",
      `# ${expense.category}`,
      "",
      `- date: ${expense.date}`,
      `- amount: ${expense.amount} ${currency}`,
      "",
    ];
    return lines.join("\n");
  }

  private buildMonthlySavingsSnapshotNoteContent(snapshot: MonthlySavingsSnapshot): string {
    const normalizedSnapshot = this.normalizeMonthlySavingsSnapshot(snapshot);
    const balanceLines = Object.entries(normalizedSnapshot.balances)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amount]) => `  ${currency}: ${amount}`);
    const lines: string[] = [
      "---",
      "type: monthly-savings-snapshot",
      `month: ${JSON.stringify(normalizedSnapshot.month)}`,
      "balances:",
      ...balanceLines,
      "---",
      "",
      `# Savings ${normalizedSnapshot.month}`,
      "",
      ...Object.entries(normalizedSnapshot.balances)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amount]) => `- ${currency}: ${amount}`),
      "",
    ];
    return lines.join("\n");
  }

  private async ensureFolder(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    if (!normalized) return true;
    const parts = normalized.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) {
        new Notice(`Cannot create notes folder: ${current} is a file`);
        return false;
      }
      await this.app.vault.createFolder(current);
    }
    return true;
  }

  private sanitizeFileName(name: string): string {
    const trimmed = name.trim();
    const cleaned = trimmed.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ");
    return cleaned || "entry";
  }

  private slugifyPathPart(value: string): string {
    const trimmed = value.trim().toLowerCase();
    const cleaned = trimmed
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return cleaned || "item";
  }

  private async findEntryNoteById(entryId: string, notesPath: string): Promise<TFile | null> {
    return this.findNoteById(entryId, notesPath, ["expense", "income"]);
  }

  private async findMonthlySavingsSnapshotNoteByMonth(monthKey: string, notesPath: string): Promise<TFile | null> {
    const folder = normalizePath(notesPath ?? "");
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (folder && !file.path.startsWith(`${folder}/`)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;
      if (frontmatter?.type !== "monthly-savings-snapshot") continue;
      const fileMonth = this.normalizeFrontmatterMonth(frontmatter.month);
      if (fileMonth === monthKey) {
        return file;
      }
    }
    return null;
  }

  private async findNoteById(
    entryId: string,
    notesPath: string,
    type: "expense" | "income" | "manual-expense" | Array<"expense" | "income" | "manual-expense">,
  ): Promise<TFile | null> {
    const folder = normalizePath(notesPath ?? "");
    const allowedTypes = Array.isArray(type) ? type : [type];
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (folder && !file.path.startsWith(`${folder}/`)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;
      const frontmatterType = frontmatter?.type;
      const id = frontmatter?.id;
      if (typeof frontmatterType !== "string" || !allowedTypes.includes(frontmatterType as "expense" | "income" | "manual-expense")) {
        continue;
      }
      if (typeof id === "string" && id === entryId) {
        return file;
      }
    }
    return null;
  }

  private parseEntryFromFrontmatter(frontmatter: any, file: TFile): Expense | null {
    const idRaw = typeof frontmatter.id === "string" ? frontmatter.id.trim() : "";
    const id = idRaw || `note:${file.path}`;
    const nameRaw = typeof frontmatter.name === "string" ? frontmatter.name : file.basename;
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    const amountRaw = frontmatter.amount;
    const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
    const currencyRaw = typeof frontmatter.currency === "string" ? frontmatter.currency : "";
    const currency = currencyRaw.trim().toUpperCase();
    const cadenceRaw = typeof frontmatter.cadence === "string" ? frontmatter.cadence : "";
    const cadence = cadenceRaw === "monthly" || cadenceRaw === "yearly" ? cadenceRaw : "";
    const startRaw =
      typeof frontmatter.start === "string"
        ? frontmatter.start
        : typeof frontmatter.startMonth === "string"
          ? frontmatter.startMonth
          : "";
    const startMonth = startRaw ? startRaw.trim() : "";

    if (!name || !Number.isFinite(amount) || !currency || !cadence) return null;

    return {
      id,
      name,
      amount,
      currency,
      cadence: cadence as ExpenseCadence,
      startMonth: startMonth || undefined,
    };
  }

  private parseManualExpenseFromFrontmatter(frontmatter: any, file: TFile): ManualExpense | null {
    const id = this.normalizeFrontmatterString(frontmatter.id);
    const date = this.normalizeFrontmatterDate(frontmatter.date);
    const category = this.normalizeFrontmatterString(frontmatter.category);
    const amount = this.normalizeFrontmatterNumber(frontmatter.amount);
    const currency = this.normalizeFrontmatterString(frontmatter.currency).toUpperCase();

    if (!id || !date || !this.isValidDayKey(date) || !category || amount <= 0 || !Number.isFinite(amount) || !currency) {
      return null;
    }

    return {
      id,
      type: "manual-expense",
      date,
      category,
      amount,
      currency,
      month: date.slice(0, 7),
      year: Number(date.slice(0, 4)),
      monthIndex: Number(date.slice(5, 7)) - 1,
      notePath: file.path,
    };
  }

  private parseMonthlySavingsSnapshotFromFrontmatter(frontmatter: any, file: TFile): MonthlySavingsSnapshot | null {
    const month = this.normalizeFrontmatterMonth(frontmatter.month);
    if (!month || !this.isValidMonthKey(month)) {
      return null;
    }

    const balancesRaw = frontmatter.balances;
    if (!balancesRaw || typeof balancesRaw !== "object" || Array.isArray(balancesRaw)) {
      return null;
    }

    const balances: Record<string, number> = {};
    for (const [currencyRaw, amountRaw] of Object.entries(balancesRaw)) {
      const currency = currencyRaw.trim().toUpperCase();
      const amount = this.normalizeFrontmatterNumber(amountRaw);
      if (!currency || !Number.isFinite(amount) || amount < 0) {
        return null;
      }
      balances[currency] = amount;
    }

    return {
      type: "monthly-savings-snapshot",
      month,
      year: Number(month.slice(0, 4)),
      monthIndex: Number(month.slice(5, 7)) - 1,
      balances,
      notePath: file.path,
    };
  }

  private normalizeFrontmatterString(value: unknown): string {
    if (typeof value === "string") {
      return value.trim();
    }
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return "";
  }

  private normalizeFrontmatterDate(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return this.normalizeFrontmatterString(value);
  }

  private normalizeFrontmatterMonth(value: unknown): string {
    const normalized = this.normalizeFrontmatterString(value);
    if (this.isValidMonthKey(normalized)) {
      return normalized;
    }
    if (this.isValidDayKey(normalized)) {
      return normalized.slice(0, 7);
    }
    return normalized;
  }

  private normalizeFrontmatterNumber(value: unknown): number {
    return typeof value === "number" ? value : Number(value);
  }

  private normalizeMonthlySavingsSnapshot(snapshot: MonthlySavingsSnapshot): MonthlySavingsSnapshot {
    const month = this.normalizeFrontmatterMonth(snapshot.month);
    if (!month || !this.isValidMonthKey(month)) {
      throw new Error(`Invalid month key: ${snapshot.month}`);
    }

    return {
      ...snapshot,
      type: "monthly-savings-snapshot",
      month,
      year: Number(month.slice(0, 4)),
      monthIndex: Number(month.slice(5, 7)) - 1,
      balances: this.normalizeBalances(snapshot.balances),
      notePath: snapshot.notePath || this.getMonthlySavingsSnapshotNotePath(month, this.normalizeNotesPath()),
    };
  }

  private normalizeBalances(balances: Record<string, number>): Record<string, number> {
    const normalized: Record<string, number> = {};
    for (const [currencyRaw, amountRaw] of Object.entries(balances ?? {})) {
      const currency = currencyRaw.trim().toUpperCase();
      const amount = this.normalizeFrontmatterNumber(amountRaw);
      if (!currency || !Number.isFinite(amount) || amount < 0) {
        continue;
      }
      normalized[currency] = amount;
    }
    return normalized;
  }

  private buildMonthKey(year: number, monthIndex: number): string {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  }

  private monthKeyToRef(monthKey: string): MonthRef {
    const year = Number(monthKey.slice(0, 4));
    const month = Number(monthKey.slice(5, 7)) - 1;
    const strings = STRINGS[this.settings.language] ?? STRINGS.en;
    return {
      year,
      month,
      key: monthKey,
      label: new Date(year, month, 1).toLocaleString(strings.locale, { month: "short", year: "numeric" }),
    };
  }

  private extractCategoriesFromExpenses(expenses: ManualExpense[]): string[] {
    const labels = new Map<string, string>();
    for (const expense of expenses) {
      const label = expense.category.trim();
      const normalized = label.toLocaleLowerCase();
      if (!label || labels.has(normalized)) continue;
      labels.set(normalized, label);
    }
    return [...labels.values()].sort((left, right) => left.localeCompare(right));
  }

  private normalizeCategorySelection(selectedCategories: string[], availableCategories: string[]): string[] {
    if (!selectedCategories.length) return [];
    const allowed = new Map(
      availableCategories.map((category) => [category.trim().toLocaleLowerCase(), category] as const),
    );
    const normalized: string[] = [];
    for (const category of selectedCategories) {
      const match = allowed.get(category.trim().toLocaleLowerCase());
      if (match && !normalized.includes(match)) {
        normalized.push(match);
      }
    }
    return normalized;
  }

  private isValidDayKey(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  private isValidMonthKey(value: string): boolean {
    return /^\d{4}-\d{2}$/.test(value);
  }

  private async collectManualExpensesFromNotes(): Promise<{
    expenses: ManualExpense[];
    invalidCount: number;
    duplicateIds: string[];
  }> {
    const folder = this.normalizeNotesPath();
    const files = this.app.vault.getMarkdownFiles();
    const expenses = new Map<string, ManualExpense>();
    const duplicateIds = new Set<string>();
    let invalidCount = 0;

    for (const file of files) {
      if (folder && !file.path.startsWith(`${folder}/`)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;
      if (!frontmatter || frontmatter.type !== "manual-expense") continue;
      const expense = this.parseManualExpenseFromFrontmatter(frontmatter, file);
      if (!expense) {
        invalidCount += 1;
        continue;
      }
      if (expenses.has(expense.id)) {
        duplicateIds.add(expense.id);
        continue;
      }
      expenses.set(expense.id, expense);
    }

    return {
      expenses: [...expenses.values()].sort((left, right) => right.date.localeCompare(left.date)),
      invalidCount,
      duplicateIds: [...duplicateIds.values()].sort((left, right) => left.localeCompare(right)),
    };
  }

  private async collectMonthlySavingsSnapshotsFromNotes(): Promise<{
    snapshots: MonthlySavingsSnapshot[];
    invalidCount: number;
    duplicateMonths: string[];
  }> {
    const folder = this.normalizeNotesPath();
    const files = this.app.vault.getMarkdownFiles();
    const snapshots = new Map<string, MonthlySavingsSnapshot>();
    const duplicateMonths = new Set<string>();
    let invalidCount = 0;

    for (const file of files) {
      if (folder && !file.path.startsWith(`${folder}/`)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;
      if (!frontmatter || frontmatter.type !== "monthly-savings-snapshot") continue;
      const snapshot = this.parseMonthlySavingsSnapshotFromFrontmatter(frontmatter, file);
      if (!snapshot) {
        invalidCount += 1;
        continue;
      }
      if (snapshots.has(snapshot.month)) {
        duplicateMonths.add(snapshot.month);
        continue;
      }
      snapshots.set(snapshot.month, snapshot);
    }

    return {
      snapshots: [...snapshots.values()].sort((left, right) => right.month.localeCompare(left.month)),
      invalidCount,
      duplicateMonths: [...duplicateMonths.values()].sort((left, right) => left.localeCompare(right)),
    };
  }
}
