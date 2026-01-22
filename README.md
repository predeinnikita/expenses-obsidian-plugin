# Expenses Obsidian Plugin

Track recurring expenses and income inside Obsidian with automatic currency conversion by Bank of Russia rates. The plugin stores entries as markdown notes and shows tables plus charts in a dedicated side view.

## Features
- Add monthly or yearly expenses and income (USD, EUR, AMD, RUB).
- Store entries as markdown notes.
- Choose a base currency; totals and charts convert using historical CBR rates per month.
- Optional start month to include expenses/income from a specific date.
- Charts for cashflow (waterfall) and spending split (pie).
- Language toggle: English, Russian, Spanish.

## Install plugin locally
1) Build: `npm install` then `npm run build` (outputs `dist/main.js`).
2) Copy to your vault: create `<vault>/.obsidian/plugins/expenses-tracker/` and place `manifest.json`, `styles.css`, `dist/main.js`, `dist/main.js.map`.
3) Enable Community Plugins in Obsidian, then enable “Expenses”.

## Usage
- Open the view via the ribbon pie-chart icon or command palette “Open expenses”.
- Configure in settings:
  - Language
  - Base currency
  - Months to show
  - Notes folder for expense/income entries (default `Expenses`).
  - Manage expenses and income (add/edit/delete). Choose monthly/yearly, currency, and optional start month (YYYY-MM).
- The view shows:
  - Waterfall chart for income → expenses → balance in the base currency.
  - Pie chart of the latest month’s expense split.
  - Table of current month expenses and income with converted amounts.
  - Table of monthly totals for the selected range.

### Notes format
Entries are stored as markdown files in the notes folder with frontmatter:

```markdown
---
type: expense
id: <uuid>
name: "Rent"
amount: 75000
currency: RUB
cadence: monthly
start: 2024-01
---
```

Supported `type` values: `expense`, `income`. The plugin reads entries from these notes, so you can also edit frontmatter manually.

## Development
- `npm run dev` for watch build.
- `npm run build` for production bundle.
- `npm run check` for type checks.
