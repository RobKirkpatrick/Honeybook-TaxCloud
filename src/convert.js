/*
 * HoneyBook Payments report -> TaxCloud CSV upload converter.
 * Pure functions, no DOM. Works in the browser (window.HBTC) and Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HBTC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAXCLOUD_COLUMNS = [
    'OrderID', 'CustomerID', 'TransactionDate', 'AuthorizedDate', 'CapturedDate',
    'DeliveredBySeller', 'ShipFromAddr1', 'ShipFromAddr2', 'ShipFromCity', 'ShipFromState',
    'ShipFromZip5', 'ShipFromZip4', 'ShipToAddr1', 'ShipToAddr2', 'ShipToCity', 'ShipToState',
    'ShipToZip5', 'ShipToZip4', 'CartItemIndex', 'CartItem', 'CartItemTIC', 'CartItemPrice',
    'CartItemQty', 'CartItemTaxRate', 'CartItemTaxAmount', 'ExcludeFromFiling',
    'ExemptionCertificateID', 'OrderKind'
  ];
  var REVIEW_COLUMNS = ['Wedding/Payment', 'HB Tax Collected', 'HB Tax Rate'];
  var MAX_ROWS_PER_FILE = 1000;

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function defaultSettings() {
    return {
      companyName: '',
      company: '', // optional: only include this HoneyBook COMPANY_NAME
      shipFrom: { addr1: '', city: '', state: '', zip5: '' },
      tic: '94001',
      itemName: 'Wedding Floral & Decor',
      mode: 'PAYMENT_DATE', // or EVENT_DATE
      quarterStart: '', // ISO yyyy-mm-dd, blank = no lower bound
      quarterEnd: '',
      internalDomain: '', // e.g. "yourbusiness.com": payments from your own address use the project name
      payerOverrides: [], // [{ match: 'Payer Name', customerId: 'ClientId' }]
      idOverrides: [] // [{ from: 'RawId', to: 'FinalId' }]
    };
  }

  // ---- CSV -----------------------------------------------------------------

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], field = '', inQuotes = false, i = 0, c;
    while (i < text.length) {
      c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
  }

  function csvToObjects(text) {
    var rows = parseCSV(text);
    if (!rows.length) return { headers: [], records: [] };
    var headers = rows[0].map(function (h) { return h.trim(); });
    var records = rows.slice(1).map(function (r) {
      var o = {};
      headers.forEach(function (h, idx) { o[h] = r[idx] === undefined ? '' : r[idx]; });
      return o;
    });
    return { headers: headers, records: records };
  }

  function csvEscape(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(headers, rows) {
    var lines = [headers.map(csvEscape).join(',')];
    rows.forEach(function (r) { lines.push(r.map(csvEscape).join(',')); });
    return lines.join('\r\n') + '\r\n';
  }

  // ---- Values --------------------------------------------------------------

  // "Jul 01, 2026" -> "2026-07-01" (also accepts ISO and m/d/yyyy). '' when unparseable.
  function parseDate(s) {
    s = (s || '').trim();
    var m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
    if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return iso(+m[3], +m[1], +m[2]);
    return '';
  }
  function iso(y, m, d) {
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }

  // Money as integer cents so sums never drift ("146325.25999999998" etc).
  function toCents(s) {
    var n = parseFloat(String(s === undefined || s === null ? '' : s).replace(/[$,\s]/g, ''));
    return isNaN(n) ? 0 : Math.round(n * 100);
  }
  function centsToStr(c) {
    var sign = c < 0 ? '-' : '';
    c = Math.abs(c);
    return sign + Math.floor(c / 100) + '.' + ('0' + (c % 100)).slice(-2);
  }

  function baseInvoice(inv) {
    return (inv || '').trim().replace(/^#/, '').replace(/-\d+$/, '');
  }

  // ---- CustomerID ----------------------------------------------------------

  function cleanProjectName(name) {
    return (name || '')
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
      .replace(/['’]s Project\b/gi, ' ')
      .replace(/['’]s\b/gi, ' ')
      .replace(/\b(Wedding|Proposal|Invoice|Celebration)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function alnum(s) { return (s || '').replace(/[^A-Za-z0-9]/g, ''); }

  function deriveCustomerId(rec, settings) {
    var clientInfo = rec.CLIENT_INFO || '';
    var raw = clientInfo.split('(')[0].trim();
    var id = null, i, o;

    var payers = settings.payerOverrides || [];
    for (i = 0; i < payers.length; i++) {
      o = payers[i];
      if (o.match && o.customerId && raw.toLowerCase().indexOf(o.match.toLowerCase()) !== -1) {
        id = o.customerId; break;
      }
    }

    if (id === null) {
      var dom = (settings.internalDomain || '').trim().toLowerCase();
      // VENDOR_INFO is always the business itself, so only the client side identifies an internal payment.
      var internal = dom && clientInfo.toLowerCase().indexOf(dom) !== -1;
      id = alnum(internal ? cleanProjectName(rec.PROJECT_NAME) : raw);
    }

    var ids = settings.idOverrides || [];
    for (i = 0; i < ids.length; i++) {
      if (ids[i].from && ids[i].from.toLowerCase() === id.toLowerCase()) { id = ids[i].to; break; }
    }
    return id;
  }

  // ---- Venues --------------------------------------------------------------

  // venue records: objects with CustomerID and/or ProjectName plus ShipTo* fields.
  function buildVenueIndex(venueRecords) {
    var byProject = {}, byCustomer = {};
    (venueRecords || []).forEach(function (v) {
      var addr = {
        addr1: (v.ShipToAddr1 || '').trim(), addr2: (v.ShipToAddr2 || '').trim(),
        city: (v.ShipToCity || '').trim(), state: (v.ShipToState || '').trim(),
        zip5: (v.ShipToZip5 || '').trim().slice(0, 5)
      };
      if (!addr.addr1) return;
      if (v.ProjectName && v.ProjectName.trim()) byProject[v.ProjectName.trim().toLowerCase()] = addr;
      if (v.CustomerID && v.CustomerID.trim()) byCustomer[v.CustomerID.trim().toLowerCase()] = addr;
    });
    return { byProject: byProject, byCustomer: byCustomer };
  }

  function lookupVenue(index, projectName, customerId) {
    return index.byProject[(projectName || '').trim().toLowerCase()] ||
      index.byCustomer[(customerId || '').toLowerCase()] || null;
  }

  // ---- Conversion ----------------------------------------------------------

  function inQuarter(isoDate, s) {
    if (!isoDate) return false;
    if (s.quarterStart && isoDate < s.quarterStart) return false;
    if (s.quarterEnd && isoDate > s.quarterEnd) return false;
    return true;
  }

  function signedPreTaxCents(rec) {
    var pre = toCents(rec.NON_TAXABLE_AMOUNT) + toCents(rec.TAXABLE_AMOUNT_1);
    var status = (rec.PAYMENT_STATUS || '').trim();
    var total = toCents(rec.TOTAL_AMOUNT);
    if (status === 'Full Refund') return -Math.abs(pre);
    if (status === 'Partial Refund' && total === 0) return -Math.abs(pre);
    return pre; // Paid, or Partial Refund lines carrying their own sign
  }

  /*
   * records: HoneyBook rows as objects. settings: see defaultSettings().
   * venueRecords: optional venue-list rows. overrides: { projectName: {addr1,...} } typed in-page.
   * Returns { rows, skipped, companies, warnings }.
   */
  function convert(records, settings, venueRecords, manualVenues) {
    var s = Object.assign(defaultSettings(), settings || {});
    var venues = buildVenueIndex(venueRecords);
    manualVenues = manualVenues || {};
    var skipped = { noInvoice: 0, outOfRange: 0, otherCompany: 0 };
    var groups = {}, order = [];

    records.forEach(function (rec) {
      if (!(rec.INVOICE || '').trim()) { skipped.noInvoice++; return; } // HoneyBook totals row
      if (s.company && (rec.COMPANY_NAME || '') !== s.company) { skipped.otherCompany++; return; }
      var txDate = parseDate(rec.TRANSACTION_DATE);
      var projDate = parseDate(rec.PROJECT_DATE);
      var filterDate = s.mode === 'EVENT_DATE' ? projDate : txDate;
      if ((s.quarterStart || s.quarterEnd) && !inQuarter(filterDate, s)) { skipped.outOfRange++; return; }

      var key = (rec.PROJECT_NAME || '').trim() || ('invoice:' + baseInvoice(rec.INVOICE));
      var g = groups[key];
      if (!g) { g = groups[key] = { projectName: key, ids: {}, cents: 0, taxCents: 0, dates: [], invoices: [], firstRate: '' }; order.push(key); }
      var cid = deriveCustomerId(rec, s);
      g.ids[cid] = (g.ids[cid] || 0) + 1;
      g.cents += signedPreTaxCents(rec);
      g.taxCents += toCents(rec.TAX_1);
      var d = s.mode === 'EVENT_DATE' ? projDate : txDate;
      if (d) g.dates.push(d);
      var inv = baseInvoice(rec.INVOICE);
      if (inv) g.invoices.push(inv);
      if (!g.firstRate) g.firstRate = (rec.TAX_RATE_1 || '').trim();
    });

    var rows = order.map(function (key) {
      var g = groups[key];
      var customerId = pickCustomerId(g.ids);
      var date = g.dates.slice().sort().pop() || '';
      var venue = manualVenues[key] || lookupVenue(venues, key, customerId);
      return {
        projectName: key,
        orderId: g.invoices.slice().sort()[0] || '',
        customerId: customerId,
        date: date.replace(/-/g, ''),
        priceCents: Math.abs(g.cents),
        qty: g.cents < 0 ? -1 : 1,
        taxCents: g.taxCents,
        taxRate: g.firstRate,
        venue: venue,
        missingVenue: !venue
      };
    });

    rows.sort(function (a, b) {
      var x = a.customerId.toLowerCase(), y = b.customerId.toLowerCase();
      if (x !== y) return x < y ? -1 : 1;
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });

    return { rows: rows, skipped: skipped };
  }

  // Most common ID; on a tie prefer the longer one (e.g. "SamanthaandJared" over "SamanthaThompson").
  function pickCustomerId(counts) {
    var best = '', bestN = -1;
    Object.keys(counts).forEach(function (id) {
      var n = counts[id];
      if (n > bestN || (n === bestN && id.length > best.length)) { best = id; bestN = n; }
    });
    return best;
  }

  // ---- Output --------------------------------------------------------------

  function toTaxCloudRow(r, s) {
    var v = r.venue || { addr1: '', addr2: '', city: '', state: '', zip5: '' };
    var f = s.shipFrom || {};
    return [
      r.orderId, r.customerId, r.date, r.date, r.date,
      '1', f.addr1 || '', '', f.city || '', f.state || '', (f.zip5 || '').slice(0, 5), '',
      v.addr1, v.addr2, v.city, v.state, v.zip5, '',
      '1', s.itemName || 'Wedding Floral & Decor', s.tic || '94001',
      centsToStr(r.priceCents), String(r.qty), '0', '0', 'false', '', ''
    ];
  }

  function toReviewRow(r) {
    return [r.projectName, centsToStr(r.taxCents), r.taxRate];
  }

  // Splits into files of at most MAX_ROWS_PER_FILE rows (TaxCloud's per-upload limit).
  function buildUploadFiles(rows, settings, includeReview) {
    var s = Object.assign(defaultSettings(), settings || {});
    var headers = TAXCLOUD_COLUMNS.concat(includeReview ? REVIEW_COLUMNS.map(function (c) { return 'DELETE BEFORE UPLOAD >>> ' + c; }) : []);
    var files = [];
    for (var i = 0; i < rows.length || (i === 0 && !files.length); i += MAX_ROWS_PER_FILE) {
      var chunk = rows.slice(i, i + MAX_ROWS_PER_FILE).map(function (r) {
        var out = toTaxCloudRow(r, s);
        return includeReview ? out.concat(toReviewRow(r)) : out;
      });
      files.push(toCSV(headers, chunk));
    }
    return files;
  }

  function summarize(rows) {
    var signed = 0, tax = 0, missing = 0;
    rows.forEach(function (r) {
      signed += r.priceCents * r.qty;
      tax += r.taxCents;
      if (r.missingVenue) missing++;
    });
    return { rowCount: rows.length, totalPreTax: centsToStr(signed), hbTaxCollected: centsToStr(tax), missingVenues: missing };
  }

  function venuesToCSV(rows) {
    var headers = ['CustomerID', 'ProjectName', 'ShipToAddr1', 'ShipToAddr2', 'ShipToCity', 'ShipToState', 'ShipToZip5'];
    var out = rows.filter(function (r) { return r.venue; }).map(function (r) {
      return [r.customerId, r.projectName, r.venue.addr1, r.venue.addr2, r.venue.city, r.venue.state, r.venue.zip5];
    });
    return toCSV(headers, out);
  }

  return {
    TAXCLOUD_COLUMNS: TAXCLOUD_COLUMNS,
    REVIEW_COLUMNS: REVIEW_COLUMNS,
    MAX_ROWS_PER_FILE: MAX_ROWS_PER_FILE,
    defaultSettings: defaultSettings,
    parseCSV: parseCSV,
    csvToObjects: csvToObjects,
    toCSV: toCSV,
    parseDate: parseDate,
    toCents: toCents,
    centsToStr: centsToStr,
    baseInvoice: baseInvoice,
    deriveCustomerId: deriveCustomerId,
    convert: convert,
    buildUploadFiles: buildUploadFiles,
    summarize: summarize,
    venuesToCSV: venuesToCSV
  };
});
