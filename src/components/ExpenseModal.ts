import { Modal, Notice, Setting } from "obsidian";
import type { Expense } from "../model/Expense";
import type { ExpenseCadence } from "../model/ExpenseCadence";
import type { Strings } from "../model/Strings";

export class ExpenseModal extends Modal {
  private data: Expense;
  private onSubmit: (expense: Expense) => void;
  private strings: Strings[keyof Strings];

  constructor(app: any, expense: Expense | null, onSubmit: (expense: Expense) => void, strings: Strings[keyof Strings]) {
    super(app);
    this.onSubmit = onSubmit;
    this.strings = strings;
    this.data =
      expense ??
      ({
        id: crypto.randomUUID?.() ?? `${Date.now()}`,
        name: "",
        amount: 0,
        currency: "RUB",
        cadence: "monthly",
        startMonth: "",
      } satisfies Expense);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const strings = this.strings;
    contentEl.createEl("h3", { text: strings.modalTitle });

    new Setting(contentEl).setName(strings.name).addText((text) =>
      text.setValue(this.data.name).onChange((value) => (this.data.name = value)),
    );

    new Setting(contentEl).setName(strings.amount).addText((text) =>
      text
        .setPlaceholder("1000")
        .setValue(String(this.data.amount || ""))
        .onChange((value) => {
          const num = Number(value);
          if (!Number.isNaN(num)) this.data.amount = num;
        }),
    );

    new Setting(contentEl).setName(strings.currency).addText((text) =>
      text
        .setPlaceholder("USD, EUR, RUB")
        .setValue(this.data.currency)
        .onChange((value) => (this.data.currency = value.toUpperCase())),
    );

    new Setting(contentEl)
      .setName(strings.cadence)
      .setDesc(strings.cadenceDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("monthly", strings.cadenceLabel.monthly)
          .addOption("yearly", strings.cadenceLabel.yearly)
          .setValue(this.data.cadence)
          .onChange((value) => (this.data.cadence = value as ExpenseCadence)),
      );

    new Setting(contentEl)
      .setName(strings.start)
      .setDesc(strings.startDesc)
      .addText((text) =>
        text
          .setPlaceholder("2024-01")
          .setValue(this.data.startMonth ?? "")
          .onChange((value) => (this.data.startMonth = value.trim())),
      );

    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const submit = footer.createEl("button", { text: strings.save });
    submit.addEventListener("click", () => {
      if (!this.data.name || !this.data.amount || !this.data.currency) {
        new Notice(strings.missingFields);
        return;
      }
      this.close();
      this.onSubmit(this.data);
    });
  }
}
