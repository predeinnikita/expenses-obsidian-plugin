import { Notice, Plugin, WorkspaceLeaf, normalizePath, TFile, TFolder } from "obsidian";
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

  private normalizeNotesPath(): string {
    const raw = this.settings.notesPath?.trim() ?? "";
    return raw ? normalizePath(raw) : "";
  }

  private getEntryNotePath(entry: Expense, type: "expense" | "income", folder: string): string {
    const safeName = this.sanitizeFileName(entry.name);
    const fileName = `${safeName}.md`;
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

  private async findEntryNoteById(entryId: string, notesPath: string): Promise<TFile | null> {
    const folder = normalizePath(notesPath ?? "");
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (folder && !file.path.startsWith(`${folder}/`)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const id = cache?.frontmatter?.id;
      if (typeof id === "string" && id === entryId) {
        return file;
      }
    }
    return null;
  }
}
