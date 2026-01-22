import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ExpensesPlugin from "../main";
import { STRINGS } from "../model/translations";
import type { LanguageCode } from "../model/LanguageCode";
import { ExpenseModal } from "./ExpenseModal";
import type { Expense } from "../model/Expense";
import type { Strings } from "../model/Strings";

export class ExpensesSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExpensesPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en;
    containerEl.createEl("h2", { text: strings.settingsTitle });

    new Setting(containerEl)
      .setName(strings.language)
      .setDesc("UI language")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("en", "English")
          .addOption("ru", "Русский")
          .addOption("es", "Español")
          .setValue(this.plugin.settings.language ?? "en")
          .onChange(async (value) => {
            const lang = (["en", "ru", "es"].includes(value) ? value : "en") as LanguageCode;
            this.plugin.settings.language = lang;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName(strings.baseCurrency)
      .setDesc(strings.baseCurrencyDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            RUB: "RUB",
            AMD: "AMD",
            USD: "USD",
            EUR: "EUR",
          })
          .setValue(this.plugin.settings.baseCurrency ?? "RUB")
          .onChange(async (value) => {
            this.plugin.settings.baseCurrency = value.toUpperCase();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(strings.monthsToShow)
      .setDesc(strings.monthsToShowDesc)
      .addSlider((slider) =>
        slider
          .setLimits(1, 12, 1)
          .setValue(this.plugin.settings.monthsToShow)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.monthsToShow = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(strings.notesPath)
      .setDesc(strings.notesPathDesc)
      .addText((text) =>
        text
          .setPlaceholder("Expenses")
          .setValue(this.plugin.settings.notesPath ?? "")
          .onChange(async (value) => {
            this.plugin.settings.notesPath = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    const entriesContainer = containerEl.createDiv();
    void this.renderEntries(entriesContainer, strings);
  }

  private async upsertExpense(expense: Expense) {
    const entries = await this.plugin.loadEntriesFromNotes();
    if (this.hasDuplicateName(expense, entries)) {
      const strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en;
      new Notice(strings.duplicateName);
      return;
    }
    const previous = entries.expenses.find((item) => item.id === expense.id);
    await this.plugin.upsertEntryNote(expense, "expense", previous);
    this.display();
  }

  private async upsertIncome(income: Expense) {
    const entries = await this.plugin.loadEntriesFromNotes();
    if (this.hasDuplicateName(income, entries)) {
      const strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en;
      new Notice(strings.duplicateName);
      return;
    }
    const previous = entries.incomes.find((item) => item.id === income.id);
    await this.plugin.upsertEntryNote(income, "income", previous);
    this.display();
  }

  private hasDuplicateName(entry: Expense, entries: { expenses: Expense[]; incomes: Expense[] }): boolean {
    const key = entry.name.trim().toLowerCase();
    if (!key) return false;
    return this.getExistingNameKeys(entries, entry.id).includes(key);
  }

  private getExistingNameKeys(
    entries: { expenses: Expense[]; incomes: Expense[] },
    excludeId?: string,
  ): string[] {
    return [...entries.expenses, ...entries.incomes]
      .filter((entry) => entry.id !== excludeId)
      .map((entry) => entry.name.trim().toLowerCase())
      .filter(Boolean);
  }

  private async renderEntries(container: HTMLElement, strings: Strings[keyof Strings]) {
    container.empty();

    const entries = await this.plugin.loadEntriesFromNotes();

    const listHeader = container.createEl("div", { cls: "expenses-list-header" });
    listHeader.createEl("h3", { text: strings.expensesList });
    const addButton = listHeader.createEl("button", { text: strings.add });
    addButton.addEventListener("click", () => {
      new ExpenseModal(
        this.app,
        null,
        (expense) => this.upsertExpense(expense),
        strings,
        "expense",
        this.getExistingNameKeys(entries),
      ).open();
    });

    const list = container.createEl("div", { cls: "expenses-list" });
    entries.expenses.forEach((expense) => {
      const row = list.createEl("div", { cls: "expense-row" });
      row.createSpan({
        text: `${expense.name} — ${expense.amount} ${expense.currency.toUpperCase()} (${expense.cadence === "monthly" ? strings.cadenceLabel.monthly : strings.cadenceLabel.yearly})`,
      });

      if (expense.startMonth) {
        row.createSpan({ text: ` • ${strings.since} ${expense.startMonth}`, cls: "start-month" });
      }

      const actions = row.createDiv({ cls: "expense-actions" });
      const editBtn = actions.createEl("button", { text: strings.edit });
      editBtn.addEventListener("click", () => {
        new ExpenseModal(
          this.app,
          expense,
          (updated) => this.upsertExpense(updated),
          strings,
          "expense",
          this.getExistingNameKeys(entries, expense.id),
        ).open();
      });

      const deleteBtn = actions.createEl("button", { text: strings.delete });
      deleteBtn.addEventListener("click", async () => {
        await this.plugin.deleteEntryNote(expense, "expense");
        this.display();
      });
    });

    const incomeHeader = container.createEl("div", { cls: "expenses-list-header" });
    incomeHeader.createEl("h3", { text: strings.incomesList });
    const addIncomeButton = incomeHeader.createEl("button", { text: strings.add });
    addIncomeButton.addEventListener("click", () => {
      new ExpenseModal(
        this.app,
        null,
        (income) => this.upsertIncome(income),
        strings,
        "income",
        this.getExistingNameKeys(entries),
      ).open();
    });

    const incomeList = container.createEl("div", { cls: "expenses-list" });
    entries.incomes.forEach((income) => {
      const row = incomeList.createEl("div", { cls: "expense-row" });
      row.createSpan({
        text: `${income.name} — ${income.amount} ${income.currency.toUpperCase()} (${income.cadence === "monthly" ? strings.cadenceLabel.monthly : strings.cadenceLabel.yearly})`,
      });

      if (income.startMonth) {
        row.createSpan({ text: ` • ${strings.since} ${income.startMonth}`, cls: "start-month" });
      }

      const actions = row.createDiv({ cls: "expense-actions" });
      const editBtn = actions.createEl("button", { text: strings.edit });
      editBtn.addEventListener("click", () => {
        new ExpenseModal(
          this.app,
          income,
          (updated) => this.upsertIncome(updated),
          strings,
          "income",
          this.getExistingNameKeys(entries, income.id),
        ).open();
      });

      const deleteBtn = actions.createEl("button", { text: strings.delete });
      deleteBtn.addEventListener("click", async () => {
        await this.plugin.deleteEntryNote(income, "income");
        this.display();
      });
    });
  }
}
