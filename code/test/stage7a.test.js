// Local tests for stage 7a (Review Messages, Skip Messages).
// Usage: NODE_PATH=<dir with luxon> node stage7a.test.js <p3-eval-cases-v1.json> <p3-test-set-source.json>
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const AF = Object.getPrototypeOf(async function () {}).constructor;
const code = (f) => fs.readFileSync(path.join(__dirname, '..', 'nodes', f), 'utf8');
async function run(file, input, refs = {}) {
  const $ = (name) => ({ all: () => refs[name], first: () => refs[name][0], itemMatching: (k) => refs[name][k] });
  const fn = new AF('$input', '$json', '$', '$now', '$execution', 'DateTime', code(file));
  return fn({ all: () => input, first: () => input[0] }, input[0] && input[0].json, $, DateTime.now(), { id: '999' }, DateTime);
}
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

(async () => {
  const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const key = Array.isArray(raw) ? raw : raw.cases;
  const loc = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).company.locations;
  const SHIP = { T01: 'larimer', T02: 'highlands', T10: 'washpark', T11: 'larimer' };
  const [cfgItem] = await run('config.js', [{ json: {}, binary: {} }]);
  const config = cfgItem.json.config;
  const byId = (id) => key.find((k) => k.case_id === id);
  const reading = (k) => (k.expect_is_invoice === 'no'
    ? { is_invoice: false, invoice_number: null, supplier_name: null, invoice_date: null, due_date: null, currency: null, subtotal: null, tax: null, total: null, ship_to: null, line_items: [] }
    : { is_invoice: true, invoice_number: k.invoice_number, supplier_name: k.supplier, invoice_date: k.invoice_date, due_date: k.due_date, currency: k.currency,
      subtotal: Number(k.subtotal), tax: Number(k.tax), total: Number(k.total), ship_to: SHIP[k.case_id] ? loc[SHIP[k.case_id]] : null,
      line_items: k.line_items.map((l) => ({ ...l, category: /delivery|freight/i.test(l.description) ? 'freight' : /milk|cream/i.test(l.description) ? 'dairy' : 'coffee_tea' })) });
  const email = (k, extra = {}) => ({ json: { source: 'gmail', file_name: k.file_name, email_id: 'm1', sender: 'ap.test@example.com', sender_name: 'AP Test',
    subject: 'Test 7a', received_at: '2026-10-28T13:00:00.000Z', prior_dup_keys: [], config, reading: reading(k), ai_failed: false, ...extra }, binary: { data: {} } });
  const earlierT01 = { json: { id: 'recT01xxxxxxxxxxx', fields: { 'Dup key': 'highland bean roasters|HB-10482', Total: 797, Invoice: 'Highland Bean Roasters · HB-10482',
    'Received at': '2026-10-28T11:58:19.000Z', Status: 'Recorded' } } };

  const checked = await run('check_allocate.js', [email(byId('T10')), email(byId('T05')), email(byId('T11')), email(byId('T02'))]);
  const decided = await run('decide_route.js', [earlierT01], { 'Check & Allocate': checked });
  const [d10, d05, d11, d02] = decided.map((d) => d.json);
  ok(d10.route === 'needs_review' && d05.route === 'not_invoice' && d11.route === 'duplicate' && d02.route === 'recorded', 'routes: T10 needs review, T05 not invoice, T11 duplicate, T02 recorded');

  // --- Review Messages (needs review only, after the Airtable record exists)
  const toRecord = [decided[0], decided[3]].map((d) => ({ ...d, json: { ...d.json, vendor: { id: '59', name: 'Meadow Dairy Co.', match: 'one' } } }));
  const prepared = await run('prepare_record.js', toRecord);
  const created = prepared.map((p, i) => ({ json: { records: [{ id: 'recNEW' + i, fields: { PDF: 'https://drive.google.com/file/d/f' + i + '/view' } }] } }));
  const review = (await run('review_messages.js', created, { 'Prepare Record': prepared })).map((r) => r.json);
  console.log('\n--- T10 message ---\n' + review[0].text + '\n');
  ok(review.length === 1 && review[0].kind === 'needs_review', 'one message: only the needs-review invoice, not the recorded one');
  const lines = review[0].text.split('\n');
  ok(lines[0] === '⚠️ Needs review: Meadow Dairy Co. · no invoice number · $306.30', 'header: supplier, "no invoice number", total');
  ok(lines[1].startsWith('Problem: No invoice number was found') && lines[2] === 'Why it was flagged: Required fields must be readable before an invoice is recorded.' && lines[3].startsWith('What to check: Open the PDF.'), 'problem, why, what to check');
  ok(lines[4] === '<https://drive.google.com/file/d/f0/view|PDF> · <https://airtable.com/YOUR_AIRTABLE_BASE_ID/YOUR_INVOICES_TABLE_ID/recNEW0|Airtable record>', 'links to the PDF and the Airtable record');
  ok(review[0].text.includes(prepared[0].json.problem_text.replace(/'/g, "'")) && prepared[0].json.record.invoice_fields.Problem === prepared[0].json.problem_text, 'Slack text and Airtable Problem are the same statement');

  const amp = JSON.parse(JSON.stringify(prepared[0]));
  amp.json.record.invoice_fields.Supplier = 'Robertson & Associates <AP>';
  const [ampMsg] = await run('review_messages.js', [created[0]], { 'Prepare Record': [amp] });
  ok(ampMsg.json.text.startsWith('⚠️ Needs review: Robertson &amp; Associates &lt;AP&gt; ·'), '&, < and > are escaped for Slack');

  // --- Skip Messages (duplicates and non-invoices)
  const skipped = (await run('skip_messages.js', [decided[1], decided[2]])).map((s) => s.json);
  console.log('--- skipped ---\n' + skipped.map((s) => s.text).join('\n') + '\n');
  ok(skipped[0].text === '📄 Not an invoice, skipped: BrightClean_Service_Menu_2027.pdf from AP Test &lt;ap.test@example.com&gt; ("Test 7a"). If it is an invoice, forward it again or add it by hand.', 'not-invoice note with file, sender and subject (sender escaped)');
  ok(skipped[1].text === "🔁 Duplicate skipped: Highland Bean Roasters · HB-10482 · $797.00 was already recorded on Oct 28, 2026 (<https://airtable.com/YOUR_AIRTABLE_BASE_ID/YOUR_INVOICES_TABLE_ID/recT01xxxxxxxxxxx|Airtable record>). Nothing was added. It's due Nov 1, 2026.", 'duplicate note with the earlier record, its date (Denver) and the due date');

  const noSubject = { json: { ...decided[1].json, subject: '' } };
  const [ns] = await run('skip_messages.js', [noSubject]);
  ok(/\(no subject\)\. If it is an invoice/.test(ns.json.text), 'empty subject written as (no subject)');

  // two copies in one email
  const twoCopies = await run('check_allocate.js', [email(byId('T01')), email(byId('T11'))]);
  const twoDecided = await run('decide_route.js', [{ json: {} }], { 'Check & Allocate': twoCopies });
  const [same] = await run('skip_messages.js', [twoDecided[1]]);
  ok(twoDecided[1].json.route === 'duplicate' && same.json.text.startsWith('🔁 Duplicate skipped: Highland Bean Roasters · HB-10482 · $797.00 is the same invoice as HB-10482.pdf in this email. Only one copy was recorded.'), 'duplicate inside the same email names the other file');

  const errorItem = { json: { ...decided[0].json, route: 'error' } };
  ok((await run('skip_messages.js', [errorItem])).length === 0, 'error route sends nothing here (stage 7b)');

  console.log(`\n${fails} problem(s)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
