# Expenses Obsidian Plugin

Track recurring expenses inside Obsidian with automatic currency conversion by Bank of Russia rates. The plugin shows a monthly expenses table, totals per month, and charts (line + pie) in a dedicated side view.

## Features
- Add monthly or yearly expenses with currency codes (ISO).
- Choose a base currency; totals and charts convert using historical CBR rates per month.
- Supports start month to include expenses from a specific date.
- Charts for monthly trend and spending split (ECharts), responsive to theme (dark/light).
- Language toggle: English, Russian, Spanish.

## Install
1) Build: `npm install` then `npm run build` (outputs `dist/main.js`).
2) Copy to your vault: create `<vault>/.obsidian/plugins/expenses-tracker/` and place `manifest.json`, `styles.css`, `dist/main.js`, `dist/main.js.map`.
3) Enable Community Plugins in Obsidian, then enable “Expenses”.

## Usage
- Open the view via the ribbon pie-chart icon or command palette “Open expenses”.
- Configure in settings:
  - Language
  - Base currency
  - Months to show
  - Manage expenses (add/edit/delete). Choose monthly/yearly, currency, and optional start month (YYYY-MM).
- The view shows:
  - Line chart of monthly totals in the base currency.
  - Pie chart of the latest month’s split.
  - Table of current month expenses with converted amounts.
  - Table of monthly totals for the selected range.

## Development
- `npm run dev` for watch build.
- `npm run build` for production bundle.
- `npm run check` for type checks.
