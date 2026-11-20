import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dice, descriptionSimilarity } from '../server/lib/text.js';
import { toPaise, formatINR, within } from '../server/lib/money.js';
import { normalisePoRef, normaliseInvoiceNumber, parseInvoiceDate, gstinChecksumValid } from '../server/lib/normalise.js';

test('money is integer paise and formatted Indian-style', () => {
  assert.equal(toPaise('8,31,900.00'), 83190000);
  assert.equal(toPaise('₹ 450.10'), 45010);
  assert.equal(toPaise(null), null);
  assert.equal(formatINR(143960000), '₹14,39,600.00');
  assert.equal(formatINR(10000), '₹100.00');
  assert.ok(within(70500000, 70500050, 100));
});

test('PO references in different formats normalise to one form', () => {
  for (const s of ['PO-2026-0412', 'PO/2026/0412', 'po 2026 0412', '2026-0412', 'PO No. 2026/412']) assert.equal(normalisePoRef(s), 'PO-2026-0412', s);
  assert.equal(normalisePoRef('see attached'), null);
});

test('invoice numbers compare ignoring separators and case', () => {
  assert.equal(normaliseInvoiceNumber('NIM/26-27/0871'), normaliseInvoiceNumber('nim 26-27 0871'));
  assert.equal(normaliseInvoiceNumber('  '), null);
});

test('Indian dates are read day-first', () => {
  assert.equal(parseInvoiceDate('05/11/2026'), '2026-11-05');
  assert.equal(parseInvoiceDate('05-Nov-2026'), '2026-11-05');
  assert.equal(parseInvoiceDate('14.11.2026'), '2026-11-14');
  assert.equal(parseInvoiceDate('2026-11-05'), '2026-11-05');
  assert.equal(parseInvoiceDate('31/02/2026'), null);
});

test('GSTIN checksum', () => {
  for (const g of ['09AAACG4821K1ZK', '24AAICS7310M1Z6', '29AAKFN2286P1ZE', '09AAFFG5512Q1ZZ', '27AAECA9043R1Z2']) assert.ok(gstinChecksumValid(g), g);
  assert.equal(gstinChecksumValid('24AAICS7310M1Z7'), false);
});

test('text similarity tolerates rewording, not different items', () => {
  assert.ok(dice('Ganges Logistics & Freight', 'Ganges Logistics and Freight') > 0.95);
  assert.ok(descriptionSimilarity('Warehousing and handling charges for the month of Nov-2026', 'Warehousing & material handling - November 2026') >= 0.45);
  assert.ok(descriptionSimilarity('Warehousing and handling charges for the month of Nov-2026', 'Road freight Kanpur-Lucknow (per trip) - December 2026') < 0.45);
});
