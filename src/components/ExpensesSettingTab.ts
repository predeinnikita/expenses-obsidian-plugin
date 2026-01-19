import { App, PluginSettingTab, Setting } from "obsidian";
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

    const listHeader = containerEl.createEl("div", { cls: "expenses-list-header" });
    listHeader.createEl("h3", { text: strings.expensesList });
    const addButton = listHeader.createEl("button", { text: strings.add });
    addButton.addEventListener("click", () => {
      new ExpenseModal(this.app, null, (expense) => this.upsertExpense(expense), strings).open();
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
        new ExpenseModal(this.app, expense, (updated) => this.upsertExpense(updated), strings).open();
      });

      const deleteBtn = actions.createEl("button", { text: strings.delete });
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
