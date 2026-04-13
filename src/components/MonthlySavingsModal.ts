import { Modal, Notice } from "obsidian";
import type { MonthlySavingsSnapshot } from "../model/MonthlySavingsSnapshot";
import type { Strings } from "../model/Strings";

type BalanceRow = {
  currency: string;
  amount: string;
};

export class MonthlySavingsModal extends Modal {
  private monthKey: string;
  private rows: BalanceRow[];

  constructor(
    app: any,
    snapshot: MonthlySavingsSnapshot | undefined,
    suggestedMonthKey: string,
    private readonly onSubmit: (monthKey: string, balances: Record<string, number>) => void,
    private readonly strings: Strings[keyof Strings],
  ) {
    super(app);
    this.monthKey = snapshot?.month ?? suggestedMonthKey;
    this.rows = this.snapshotToRows(snapshot);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.strings.monthlySavingsModalTitle });

    const monthField = contentEl.createDiv({ cls: "monthly-savings-month-field" });
    monthField.createEl("label", { text: this.strings.monthlySavingsMonth });
    const monthInput = monthField.createEl("input", { type: "text" });
    monthInput.value = this.monthKey;
    monthInput.placeholder = "2026-04";
    monthInput.addEventListener("input", () => {
      this.monthKey = monthInput.value.trim();
    });

    const rowsContainer = contentEl.createDiv({ cls: "monthly-savings-rows" });
    const renderRows = () => {
      rowsContainer.empty();
      this.rows.forEach((row, index) => {
        const rowEl = rowsContainer.createDiv({ cls: "monthly-savings-row" });

        const currencyField = rowEl.createDiv({ cls: "monthly-savings-field" });
        currencyField.createEl("label", { text: this.strings.monthlySavingsCurrency });
        const currencySelect = currencyField.createEl("select");
        ["AMD", "EUR", "RUB", "USD"].forEach((currency) => {
          const option = currencySelect.createEl("option", { text: currency });
          option.value = currency;
        });
        currencySelect.value = row.currency;
        currencySelect.addEventListener("change", () => {
          this.rows[index].currency = currencySelect.value.toUpperCase();
        });

        const amountField = rowEl.createDiv({ cls: "monthly-savings-field" });
        amountField.createEl("label", { text: this.strings.monthlySavingsAmount });
        const amountInput = amountField.createEl("input", { type: "number" });
        amountInput.value = row.amount;
        amountInput.placeholder = "0";
        amountInput.addEventListener("input", () => {
          this.rows[index].amount = amountInput.value;
        });

        const removeButton = rowEl.createEl("button", {
          text: this.strings.monthlySavingsRemoveRow,
          cls: "monthly-savings-row-remove",
        });
        removeButton.type = "button";
        removeButton.addEventListener("click", () => {
          this.rows.splice(index, 1);
          if (!this.rows.length) {
            this.rows.push({ currency: "AMD", amount: "" });
          }
          renderRows();
        });
      });
    };

    renderRows();

    const addRowButton = contentEl.createEl("button", {
      text: this.strings.monthlySavingsAddRow,
      cls: "monthly-savings-row-add",
    });
    addRowButton.type = "button";
    addRowButton.addEventListener("click", () => {
      this.rows.push({ currency: "AMD", amount: "" });
      renderRows();
    });

    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const submit = footer.createEl("button", { text: this.strings.save });
    submit.addEventListener("click", () => {
      if (!this.isValidMonth(this.monthKey)) {
        new Notice(this.strings.monthlySavingsInvalidMonth);
        return;
      }

      const balances: Record<string, number> = {};
      const seenCurrencies = new Set<string>();
      for (const row of this.rows) {
        const currency = row.currency.trim().toUpperCase();
        const amountRaw = row.amount.trim();
        if (!amountRaw) {
          continue;
        }
        const amount = Number(row.amount);
        if (!currency || !Number.isFinite(amount) || amount < 0) {
          new Notice(this.strings.monthlySavingsInvalidAmount);
          return;
        }
        if (seenCurrencies.has(currency)) {
          new Notice(this.strings.monthlySavingsDuplicateCurrency);
          return;
        }
        seenCurrencies.add(currency);
        balances[currency] = amount;
      }

      if (!Object.keys(balances).length) {
        new Notice(this.strings.monthlySavingsMissingBalances);
        return;
      }

      this.close();
      this.onSubmit(this.monthKey, balances);
    });
  }

  private snapshotToRows(snapshot: MonthlySavingsSnapshot | undefined): BalanceRow[] {
    const rows = Object.entries(snapshot?.balances ?? {}).map(([currency, amount]) => ({
      currency,
      amount: String(amount),
    }));
    return rows.length ? rows : [{ currency: "AMD", amount: "" }];
  }

  private isValidMonth(value: string) {
    if (!/^\d{4}-\d{2}$/.test(value)) {
      return false;
    }
    const [year, month] = value.split("-").map(Number);
    return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;
  }
}
