# HoneyBook → TaxCloud Converter

Turn a HoneyBook **Payments report** into a CSV that [TaxCloud](https://taxcloud.com) can import, without a spreadsheet.

**Use it:** open `index.html` in your browser, or visit the GitHub Pages site for this repo (Settings → Pages → deploy from `main`).

Your data never leaves your computer. There is no server and nothing is uploaded; the page works offline.

## How to use it

1. **Export from HoneyBook:** Reports → Payments → pick your date range → export CSV. **Don't edit the file or its headers.** The converter reads HoneyBook's export exactly as it comes.
2. **Open the converter** and fill in *Your business* (name and ship-from address). It's remembered in your browser, and it's yours to set: nothing is pre-filled.
3. **Drop in the CSV.** Choose whether you report by payment date or event date, set the period, and choose one row per project or per payment (see below).
4. **Give every row a ship-to address.** HoneyBook doesn't say where the event was held, but TaxCloud rejects any row without a full ship-to address: **street, city, state and 5-digit ZIP, all four**. Rows missing any part are highlighted yellow. Type them in, or load a saved venue list. If all your events are in one state, set *State to use when a venue has none*. Use *Save venue list* so next quarter is mostly automatic.
5. **Download** the TaxCloud file and import it in TaxCloud.

## One row per project or per payment?

HoneyBook gives one line per payment. You choose how that becomes TaxCloud orders:

| | **Project (default)** | **Payment** |
|---|---|---|
| Rows | One per wedding/event | One per HoneyBook payment |
| Amount | All payments added together | That payment's pre-tax amount |
| Date | Latest payment (or event date) | The payment's own date |
| OrderID | Lowest invoice number | The full invoice number (e.g. `000101-003`) |
| Refunds | Netted into the total | Their own line, quantity -1 |
| Best for | Fewer rows to review and fix venues for | Matching HoneyBook line-by-line |

Both give the same total. In *Project* mode a project with only refunds in the period comes out as quantity -1.

## What it does

- Skips HoneyBook's totals row.
- Sums pre-tax amounts (non-taxable + taxable).
- Leaves tax amount/rate as `0` because TaxCloud calculates tax itself.
- Splits into files of 1,000 rows (TaxCloud's per-upload limit).
- Produces a *review copy* with three extra columns (project, HoneyBook tax collected, rate) so you can compare. **Don't upload the review copy.**

## Customer IDs

There's nothing to set up. HoneyBook has no customer ID, so the converter makes one from the client's name with spaces and punctuation removed (`Rachel Chiglo` → `RachelChiglo`). TaxCloud only needs it to be consistent, and each project always gets the same one.

## Venue list format

Either shape works, and headers can be named loosely.

**A list of venues** (one row per venue, e.g. a master "Venue Addresses" sheet):

`venue, address 1, address 2, address 3, city, state, postal code`

Load it once. For each project, start typing the venue and pick it from the dropdown, and the address fills in. If a venue's name appears in the project name, it's picked for you. Your choices are remembered in this browser, so next quarter only new projects need attention. *Forget remembered venues* clears them.

**A list of projects** (one row per project), matched on the project name exactly as HoneyBook shows it:

`ProjectName,ShipToAddr1,ShipToAddr2,ShipToCity,ShipToState,ShipToZip5`

The *Save venue list* button writes this file, if you want to share or back up your matches.

Venues with no street address (for example "Private Residence" or just a town) stay yellow until you type the address, because TaxCloud needs a full one.

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
