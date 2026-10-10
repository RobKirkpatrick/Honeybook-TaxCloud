'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../src/convert.js');

const HEAD = 'COMPANY_NAME,PROJECT_NAME,PROJECT_DATE,VENDOR_INFO,CLIENT_INFO,INVOICE,PAYMENT_STATUS,PAYMENT_NAME,TRANSACTION_DATE,NON_TAXABLE_AMOUNT,TAXABLE_AMOUNT_1,TAX_1,TAX_RATE_1,TOTAL_AMOUNT';
function csv(lines) { return H.csvToObjects(HEAD + '\n' + lines.join('\n') + '\n').records; }
const base = { shipFrom: { addr1: '1 Main St', city: 'Denver', state: 'CO', zip5: '80202' } };

test('parses quoted CSV, BOM, and escaped quotes', () => {
  const rows = H.parseCSV('﻿a,b\n"x, y","he said ""hi"""\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"']]);
});

test('dates and money', () => {
  assert.strictEqual(H.parseDate('Jul 01, 2026'), '2026-07-01');
  assert.strictEqual(H.toCents('146325.25999999998'), 14632526);
  assert.strictEqual(H.centsToStr(-5), '-0.05');
  assert.strictEqual(H.baseInvoice('#000101-003'), '000101');
});

test('merges payments per project, sums pre-tax, latest date, lowest invoice', () => {
  const recs = csv([
    "Co,Ann Lee 08/01/26 Wedding,\"Aug 01, 2026\",v@x.com,Ann Lee (ann@x.com),#000067-001,Paid,1 of 2,\"Jul 01, 2026\",10.10,100.20,8.20,8.2%,118.50",
    "Co,Ann Lee 08/01/26 Wedding,\"Aug 01, 2026\",v@x.com,Ann Lee (ann@x.com),#000066-002,Paid,2 of 2,\"Jul 20, 2026\",0.10,50.00,4.10,8.2%,54.20",
    ',,,,,,,,,35.00,1.00,1.00,,1'
  ]);
  const { rows, skipped } = H.convert(recs, base);
  assert.strictEqual(skipped.noInvoice, 1);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].orderId, '000066');
  assert.strictEqual(rows[0].customerId, 'AnnLee');
  assert.strictEqual(rows[0].date, '20260720');
  assert.strictEqual(H.centsToStr(rows[0].priceCents), '160.40');
  assert.strictEqual(H.centsToStr(rows[0].taxCents), '12.30');
});

test('payer override and ID override', () => {
  const recs = csv([
    'Co,P1,"Aug 01, 2026",v@x.com,Pat Planner (p@x.com),#1-001,Paid,x,"Jul 01, 2026",0,100,0,0%,100',
    'Co,P2,"Aug 01, 2026",v@x.com,Sam Max (s@x.com),#2-001,Paid,x,"Jul 01, 2026",0,100,0,0%,100'
  ]);
  const s = Object.assign({}, base, {
    payerOverrides: [{ match: 'Pat Planner', customerId: 'JoeAndJen' }],
    idOverrides: [{ from: 'SamMax', to: 'SamMax9' }]
  });
  const ids = H.convert(recs, s).rows.map(r => r.customerId).sort();
  assert.deepStrictEqual(ids, ['JoeAndJen', 'SamMax9']);
});

test('internal-domain payments use cleaned project name', () => {
  const recs = csv([
    "Co,05/05/26 Kim Park's Project,\"Aug 01, 2026\",me@mine.com,Me (me@mine.com),#9-001,Paid,x,\"Jul 01, 2026\",0,100,0,0%,100"
  ]);
  const r = H.convert(recs, Object.assign({}, base, { internalDomain: 'mine.com' })).rows[0];
  assert.strictEqual(r.customerId, 'KimPark');
});

test('tie in customer IDs prefers longer combined ID', () => {
  const recs = csv([
    'Co,W,"Aug 01, 2026",v,Sam Thompson (a@x.com),#1-001,Paid,x,"Jul 01, 2026",0,100,0,0%,100',
    'Co,W,"Aug 01, 2026",v,Sam and Jared Thompson (b@x.com),#1-002,Paid,x,"Jul 02, 2026",0,100,0,0%,100'
  ]);
  assert.strictEqual(H.convert(recs, base).rows[0].customerId, 'SamandJaredThompson');
});

test('refund handling', () => {
  const recs = csv([
    'Co,A,"Aug 01, 2026",v,A One (a@x.com),#1-001,Full Refund,x,"Jul 01, 2026",0,100,8,8%,108',
    'Co,B,"Aug 01, 2026",v,B Two (b@x.com),#2-001,Partial Refund,x,"Jul 01, 2026",-10,-40,-3,8%,-53',
    'Co,B,"Aug 01, 2026",v,B Two (b@x.com),#2-001,Partial Refund,x,"Jun 01, 2026",100,300,8,8%,408',
    'Co,C,"Aug 01, 2026",v,C Three (c@x.com),#3-001,Paid,x,"Jul 01, 2026",0,100,8,8%,108',
    'Co,C,"Aug 01, 2026",v,C Three (c@x.com),#3-001,Partial Refund,x,"Jul 02, 2026",-10,-40,-3,8%,-53'
  ]);
  const by = Object.fromEntries(H.convert(recs, base).rows.map(r => [r.projectName, r]));
  assert.deepStrictEqual([by.A.qty, by.A.priceCents], [-1, 10000]);
  assert.deepStrictEqual([by.B.qty, by.B.priceCents], [1, 35000]);
  assert.deepStrictEqual([by.C.qty, by.C.priceCents], [1, 5000]);
});

test('payment-date vs event-date filtering', () => {
  const recs = csv([
    'Co,A,"Oct 05, 2026",v,A One (a@x.com),#1-001,Paid,x,"Sep 29, 2026",0,100,0,0%,100',
    'Co,B,"Aug 05, 2026",v,B Two (b@x.com),#2-001,Paid,x,"Jun 29, 2026",0,100,0,0%,100'
  ]);
  const q = { quarterStart: '2026-07-01', quarterEnd: '2026-09-30' };
  const pay = H.convert(recs, Object.assign({}, base, q, { mode: 'PAYMENT_DATE' }));
  const evt = H.convert(recs, Object.assign({}, base, q, { mode: 'EVENT_DATE' }));
  assert.deepStrictEqual(pay.rows.map(r => r.projectName), ['A']);
  assert.deepStrictEqual(evt.rows.map(r => r.projectName), ['B']);
  assert.strictEqual(evt.rows[0].date, '20260805');
});

test('venue lookup, manual override, missing flag, and output shape', () => {
  const recs = csv([
    'Co,A,"Aug 01, 2026",v,A One (a@x.com),#1-001,Paid,x,"Jul 01, 2026",0,100,8,8%,108',
    'Co,B,"Aug 01, 2026",v,B Two (b@x.com),#2-001,Paid,x,"Jul 01, 2026",0,100,8,8%,108'
  ]);
  const venues = H.csvToObjects('CustomerID,ShipToAddr1,ShipToCity,ShipToState,ShipToZip5\nAOne,9 Barn Rd,Aspen,CO,81611-1234\n').records;
  const res = H.convert(recs, base, venues);
  assert.strictEqual(res.rows[0].venue.zip5, '81611');
  assert.strictEqual(res.rows[1].missingVenue, true);
  assert.strictEqual(H.summarize(res.rows).missingVenues, 1);
  const [file] = H.buildUploadFiles(res.rows, base, false);
  const lines = file.trim().split('\r\n');
  assert.strictEqual(lines[0].split(',').length, 28);
  assert.strictEqual(H.parseCSV(file)[1].length, 28);
  const withReview = H.parseCSV(H.buildUploadFiles(res.rows, base, true)[0]);
  assert.strictEqual(withReview[0].length, 31);
  assert.strictEqual(withReview[1][25], 'false');
});

test('splits at 1000 rows', () => {
  const rows = Array.from({ length: 2300 }, (_, i) => ({ orderId: String(i), customerId: 'C' + i, date: '20260701', priceCents: 100, qty: 1, taxCents: 0, taxRate: '', projectName: 'P' + i, venue: null }));
  assert.strictEqual(H.buildUploadFiles(rows, base, false).length, 3);
});

test('vendor email on your own domain does not make client rows internal', () => {
  const recs = csv([
    'Co,Ann Lee 08/01/26 Wedding,"Aug 01, 2026",Shop (hi@mine.com),Ann Lee (ann@x.com),#1-001,Paid,x,"Jul 01, 2026",0,100,0,0%,100'
  ]);
  const r = H.convert(recs, Object.assign({}, base, { internalDomain: 'mine.com' })).rows[0];
  assert.strictEqual(r.customerId, 'AnnLee');
});

test('readPayments accepts HoneyBook headers as exported, in any style', () => {
  const upper = H.readPayments('PROJECT_NAME,INVOICE,TRANSACTION_DATE,NON_TAXABLE_AMOUNT,TAXABLE_AMOUNT_1\nA,#1-001,"Jul 01, 2026",1,2\n');
  assert.deepStrictEqual(upper.missing, []);
  const title = H.readPayments('Project Name,Invoice,Transaction Date,Non-Taxable Amount,Taxable Amount 1,Client Info\nA,#1-001,"Jul 01, 2026",1,2,Ann Lee\n');
  assert.deepStrictEqual(title.missing, []);
  assert.strictEqual(title.records[0].CLIENT_INFO, 'Ann Lee');
  const bad = H.readPayments('Project Name,Client Info,Project Date\nA,B,C\n');
  assert.ok(bad.missing.includes('INVOICE'));
});

test('readVenues accepts friendly headers and matches by project name', () => {
  const v = H.readVenues('Project Name,Street Address,City,State,Zip Code\n"Ann  Lee 08/01/26 Wedding",9 Barn Rd,Aspen,co,81611\n');
  assert.deepStrictEqual(v.missing, []);
  const recs = csv(['Co,Ann Lee 08/01/26 Wedding,"Aug 01, 2026",v,Ann Lee (a@x.com),#1-001,Paid,x,"Jul 01, 2026",0,100,0,0%,100']);
  const r = H.convert(recs, base, v.records).rows[0];
  assert.strictEqual(r.missingVenue, false);
  assert.strictEqual(r.venue.state, 'CO');
  assert.ok(H.readVenues('Name,Notes\nA,b\n').missing.includes('street address'));
});

test('venue needs street, city, state and zip; default state fills the gap', () => {
  const recs = csv(['Co,A,"Aug 01, 2026",v,A One (a@x.com),#1-001,Paid,x,"Jul 01, 2026",0,100,0,0%,100']);
  const venues = H.readVenues('Project Name,Address,City,Zip\nA,1 Rd,Aspen,81611\n').records;
  assert.strictEqual(H.convert(recs, base, venues).rows[0].missingVenue, true);
  const ok = H.convert(recs, Object.assign({}, base, { defaultShipToState: 'CO' }), venues).rows[0];
  assert.strictEqual(ok.missingVenue, false);
  assert.strictEqual(ok.venue.state, 'CO');
});

test('per-payment mode keeps one row per payment with unique order IDs', () => {
  const recs = csv([
    'Co,W,"Aug 01, 2026",v,Ann Lee (a@x.com),#74-003,Paid,x,"Jul 01, 2026",0,100,8,8%,108',
    'Co,W,"Aug 01, 2026",v,Ann Lee (a@x.com),#74-003,Partial Refund,x,"Jul 09, 2026",-5,-20,-2,8%,-27',
    'Co,W,"Aug 01, 2026",v,Pat Planner (p@x.com),#74-004,Paid,x,"Jul 20, 2026",0,50,4,8%,54'
  ]);
  const rows = H.convert(recs, Object.assign({}, base, { rowMode: 'PER_PAYMENT' })).rows;
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map(r => r.orderId), ['74-003', '74-003-2', '74-004']);
  assert.deepStrictEqual(rows.map(r => r.qty), [1, -1, 1]); // refund line: qty -1, positive price
  assert.deepStrictEqual(rows.map(r => H.centsToStr(r.priceCents)), ['100.00', '25.00', '50.00']);
  assert.strictEqual(new Set(rows.map(r => r.customerId)).size, 1); // one ID per project
  assert.deepStrictEqual(rows.map(r => r.date), ['20260701', '20260709', '20260720']);
});

test('customer ID is just the client name joined, with no setup', () => {
  const recs = csv(['Co,P,"Aug 01, 2026",v,"Mary-Ann O\'Neil (m@x.com)",#1-001,Paid,x,"Jul 01, 2026",0,100,0,0%,100']);
  assert.strictEqual(H.convert(recs, base).rows[0].customerId, 'MaryAnnONeil');
});

test('venue catalog file (venue, address 1-3, postal code) is recognised', () => {
  const v = H.readVenues('venue,address 1,address 2,address 3,city,state,postal code\n"The Loft, Inc.","2506 W Colorado Ave","Suite C",,Colorado Springs,CO,80904\nGrand Lake,,,,Grand Lake,CO,80447\n');
  assert.deepStrictEqual(v.missing, []);
  assert.strictEqual(v.records[0].VenueName, 'The Loft, Inc.');
  assert.strictEqual(v.records[0].ShipToAddr2, 'Suite C');
  assert.strictEqual(v.records[0].ShipToZip5, '80904');
  assert.strictEqual(H.venueComplete({ addr1: '', city: 'Grand Lake', state: 'CO', zip5: '80447' }), false);
});
