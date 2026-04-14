import { Modal, Notice, Setting } from "obsidian";
import type { ManualExpense } from "../model/ManualExpense";
import type { Strings } from "../model/Strings";

export class ManualExpenseModal extends Modal {
  private data: ManualExpense;
  private amountValue: string;
  private readonly categories: string[];
  private readonly isNewExpense: boolean;

  constructor(
    app: any,
    expense: ManualExpense | null,
    private readonly onSubmit: (expense: ManualExpense) => void,
    private readonly strings: Strings[keyof Strings],
    suggestedMonthKey: string,
    categories: string[],
  ) {
    super(app);
    this.categories = categories;
    this.isNewExpense = !expense;
    const today = new Date();
    const defaultDate = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    this.data = expense ?? {
      id: "",
      type: "manual-expense",
      date: defaultDate,
      category: "",
      amount: 0,
      currency: "AMD",
      month: suggestedMonthKey,
      year: Number(suggestedMonthKey.slice(0, 4)),
      monthIndex: Number(suggestedMonthKey.slice(5, 7)) - 1,
      notePath: "",
    };
    this.amountValue = this.data.amount ? String(this.data.amount) : "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const categoryOptions = this.getCategoryOptions();

    contentEl.createEl("h3", { text: this.strings.manualExpenseModalTitle });

    new Setting(contentEl).setName(this.strings.manualExpenseDate).addText((text) => {
      text.inputEl.type = "date";
      text.setValue(this.data.date).onChange((value) => (this.data.date = value.trim()));
    });

    new Setting(contentEl).setName(this.strings.manualExpenseCategory).addDropdown((dropdown) => {
      dropdown.addOption("", this.strings.manualExpenseCategoryPlaceholder);
      categoryOptions.forEach((category) => dropdown.addOption(category, category));
      dropdown.setValue(categoryOptions.includes(this.data.category) ? this.data.category : "");
      dropdown.onChange((value) => (this.data.category = value.trim()));
    });

    new Setting(contentEl).setName(this.strings.amount).addText((text) =>
      text
        .setPlaceholder("1000")
        .setValue(this.amountValue)
        .onChange((value) => {
          this.amountValue = value.trim();
        }),
    );

    new Setting(contentEl).setName(this.strings.currency).addDropdown((dropdown) =>
      dropdown
        .addOptions({
          AMD: "AMD",
          EUR: "EUR",
          RUB: "RUB",
          USD: "USD",
        })
        .setValue(this.data.currency.toUpperCase())
        .onChange((value) => (this.data.currency = value.toUpperCase())),
    );

    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const submit = footer.createEl("button", { text: this.strings.save });
    submit.addEventListener("click", () => {
      if (!this.isValidDate(this.data.date)) {
        new Notice(this.strings.manualExpenseInvalidDate);
        return;
      }
      if (!this.data.category.trim()) {
        new Notice(this.strings.manualExpenseEmptyCategory);
        return;
      }
      const amount = Number(this.amountValue);
      if (!Number.isFinite(amount) || amount <= 0) {
        new Notice(this.strings.manualExpenseInvalidAmount);
        return;
      }

      const month = this.data.date.slice(0, 7);
      this.close();
      this.onSubmit({
        ...this.data,
        id: this.isNewExpense ? this.createTimestampId(new Date()) : this.data.id,
        category: this.data.category.trim(),
        date: this.data.date,
        amount,
        month,
        year: Number(month.slice(0, 4)),
        monthIndex: Number(month.slice(5, 7)) - 1,
      });
    });
  }

  private isValidDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
      Number.isInteger(year) &&
      Number.isInteger(month) &&
      Number.isInteger(day) &&
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  private getCategoryOptions() {
    const options = [...this.categories];
    if (this.data.category && !options.includes(this.data.category)) {
      options.push(this.data.category);
    }
    return options;
  }

  private createTimestampId(value: Date): string {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
      String(value.getHours()).padStart(2, "0"),
      String(value.getMinutes()).padStart(2, "0"),
      String(value.getSeconds()).padStart(2, "0"),
    ].join("-");
  }
}
