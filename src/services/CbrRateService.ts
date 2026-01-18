import { requestUrl } from "obsidian";
import type { MonthRef } from "../model/MonthRef";
import { CBR_BASE } from "../model/constants";

export class CbrRateService {
  private cache = new Map<string, Record<string, number>>();

  async getRateForMonth(month: MonthRef, currency: string): Promise<number> {
    const upper = currency.toUpperCase();
    if (upper === "RUB") return 1;

    const key = month.key;
    let rates = this.cache.get(key);
    if (!rates) {
      rates = await this.fetchMonthRates(month);
      this.cache.set(key, rates);
    }

    return rates[upper] ?? 1;
  }

  private async fetchMonthRates(month: MonthRef): Promise<Record<string, number>> {
    const year = month.year;
    const mm = String(month.month + 1).padStart(2, "0");
    // Try the first few days of the month to avoid gaps on holidays/weekends.
    for (let day = 1; day <= 5; day++) {
      const dd = String(day).padStart(2, "0");
      const url = `${CBR_BASE}/archive/${year}/${mm}/${dd}/daily_json.js`;
      const parsed = await this.tryFetchRates(url);
      if (parsed) return parsed;
    }

    // Fallback to the latest rate if the archive is missing.
    const fallback = await this.tryFetchRates(`${CBR_BASE}/daily_json.js`);
    if (fallback) return fallback;
    return { RUB: 1 };
  }

  private async tryFetchRates(url: string): Promise<Record<string, number> | null> {
    try {
      const res = await requestUrl({ url });
      if (res.status >= 400) return null;
      const data = res.json ?? JSON.parse(res.text);
      const rates: Record<string, number> = { RUB: 1 };
      if (data?.Valute) {
        Object.entries<any>(data.Valute).forEach(([code, info]) => {
          rates[code] = info.Value / info.Nominal;
        });
      }
      return rates;
    } catch (error) {
      console.warn("Failed to fetch CBR rates", error);
      return null;
    }
  }
}
