# HoneyBook → TaxCloud Converter

Turn a HoneyBook **Payments report** into a CSV that [TaxCloud](https://taxcloud.com) can import, without a spreadsheet.

**Use it:** open `index.html` in your browser, or visit the GitHub Pages site for this repo (Settings → Pages → deploy from `main`).

Your data never leaves your computer. There is no server and nothing is uploaded; the page works offline.

## How to use it

1. **Export from HoneyBook:** Reports → Payments → pick your date range → export CSV.
2. **Open the converter** and fill in *Your business* (name and ship-from address). It's remembered in your browser, and it's yours to set: nothing is pre-filled.
3. **Drop in the CSV.** Choose whether you report by payment date or event date, and set the period.
4. **Add venue addresses.** HoneyBook doesn't include where the event was held, but TaxCloud needs it. Fill in any highlighted rows, or load a saved venue list. Use *Save venue list* so next quarter is mostly automatic.
5. **Download** the TaxCloud file and import it in TaxCloud.

## What it does

- Skips HoneyBook's totals row.
- Combines all payments for a project into one row (one order per wedding or event).
- Sums pre-tax amounts (non-taxable + taxable), keeps the latest date, uses the lowest invoice number as OrderID.
- Handles refunds (negative net becomes quantity -1 with a positive price).
- Leaves tax amount/rate as `0` because TaxCloud calculates tax itself.
- Splits into files of 1,000 rows (TaxCloud's per-upload limit).
- Produces a *review copy* with three extra columns (project, HoneyBook tax collected, rate) so you can compare. **Don't upload the review copy.**

## Customer IDs

The CustomerID comes from the client's name with spaces and punctuation removed (`Rachel Chiglo` → `RachelChiglo`). Under *Advanced* you can:

- map a payer (planner, parent) to the actual couple,
- rename an ID,
- set your email domain so invoices created under your own email use the project name.

## Venue list format

CSV with these columns (`CustomerID` or `ProjectName` is used to match; `ProjectName` wins):

`CustomerID,ProjectName,ShipToAddr1,ShipToAddr2,ShipToCity,ShipToState,ShipToZip5`

See [examples/](examples/) for a sample HoneyBook file, venue list and settings (all fictional).

## Good to know

- This tool formats data. It isn't tax advice. Compare the totals with your HoneyBook report and TaxCloud account before filing.
- The default product code (TIC) is `94001` for floral arrangements; change it under *Advanced* if you sell something else.
- Column layout follows TaxCloud's CSV import template at the time of writing. If TaxCloud changes it, open an issue.

## Development

No build step. Logic lives in `src/convert.js`; the UI is `index.html`.

```
node --test test/convert.test.js
```

MIT licensed.
