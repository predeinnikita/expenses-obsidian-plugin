import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ExpensesPlugin from "../main";
import { STRINGS } from "../model/translations";
import type { LanguageCode } from "../model/LanguageCode";
import { ExpenseModal } from "./ExpenseModal";
import type { Expense } from "../model/Expense";

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

    const listHeader = containerEl.createEl("div", { cls: "expenses-list-header" });
    listHeader.createEl("h3", { text: strings.expensesList });
    const addButton = listHeader.createEl("button", { text: strings.add });
    addButton.addEventListener("click", () => {
      new ExpenseModal(
        this.app,
        null,
        (expense) => this.upsertExpense(expense),
        strings,
        "expense",
        this.getExistingNameKeys(),
      ).open();
    });

    const list = containerEl.createEl("div", { cls: "expenses-list" });
    this.plugin.settings.expenses.forEach((expense) => {
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
          this.getExistingNameKeys(expense.id),
        ).open();
      });

      const deleteBtn = actions.createEl("button", { text: strings.delete });
      deleteBtn.addEventListener("click", async () => {
        await this.plugin.deleteEntryNote(expense, "expense");
        this.plugin.settings.expenses = this.plugin.settings.expenses.filter(
          (item) => item.id !== expense.id,
        );
        await this.plugin.saveSettings();
        this.display();
      });
    });

    const incomeHeader = containerEl.createEl("div", { cls: "expenses-list-header" });
    incomeHeader.createEl("h3", { text: strings.incomesList });
    const addIncomeButton = incomeHeader.createEl("button", { text: strings.add });
    addIncomeButton.addEventListener("click", () => {
      new ExpenseModal(
        this.app,
        null,
        (income) => this.upsertIncome(income),
        strings,
        "income",
        this.getExistingNameKeys(),
      ).open();
    });

    const incomeList = containerEl.createEl("div", { cls: "expenses-list" });
    this.plugin.settings.incomes.forEach((income) => {
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
          this.getExistingNameKeys(income.id),
        ).open();
      });

      const deleteBtn = actions.createEl("button", { text: strings.delete });
      deleteBtn.addEventListener("click", async () => {
        await this.plugin.deleteEntryNote(income, "income");
        this.plugin.settings.incomes = this.plugin.settings.incomes.filter(
          (item) => item.id !== income.id,
        );
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }

  private async upsertExpense(expense: Expense) {
    if (this.hasDuplicateName(expense)) {
      const strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en;
      new Notice(strings.duplicateName);
      return;
    }
    const existingIndex = this.plugin.settings.expenses.findIndex((e) => e.id === expense.id);
    const previous = existingIndex >= 0 ? this.plugin.settings.expenses[existingIndex] : undefined;
    if (existingIndex >= 0) {
      this.plugin.settings.expenses[existingIndex] = expense;
    } else {
      this.plugin.settings.expenses.push(expense);
    }
    await this.plugin.saveSettings();
    await this.plugin.upsertEntryNote(expense, "expense", previous);
    this.display();
  }

  private async upsertIncome(income: Expense) {
    if (this.hasDuplicateName(income)) {
      const strings = STRINGS[this.plugin.settings.language] ?? STRINGS.en;
      new Notice(strings.duplicateName);
      return;
    }
    const existingIndex = this.plugin.settings.incomes.findIndex((e) => e.id === income.id);
    const previous = existingIndex >= 0 ? this.plugin.settings.incomes[existingIndex] : undefined;
    if (existingIndex >= 0) {
      this.plugin.settings.incomes[existingIndex] = income;
    } else {
      this.plugin.settings.incomes.push(income);
    }
    await this.plugin.saveSettings();
    await this.plugin.upsertEntryNote(income, "income", previous);
    this.display();
  }

  private hasDuplicateName(entry: Expense): boolean {
    const key = entry.name.trim().toLowerCase();
    if (!key) return false;
    return this.getExistingNameKeys(entry.id).includes(key);
  }

  private getExistingNameKeys(excludeId?: string): string[] {
    const entries = [...this.plugin.settings.expenses, ...this.plugin.settings.incomes];
    return entries
      .filter((entry) => entry.id !== excludeId)
      .map((entry) => entry.name.trim().toLowerCase())
      .filter(Boolean);
  }
}
