// Local tests for stage 6a (Prepare Record, Invoice Request, Line Item Requests).
// Usage: NODE_PATH=<dir with luxon> node stage6a.test.js <p3-eval-cases-v1.json> <p3-test-set-source.json>
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const AF = Object.getPrototypeOf(async function () {}).constructor;
const code = (f) => fs.readFileSync(path.join(__dirname, '..', 'nodes', f), 'utf8');
async function run(file, input, refs = {}, eachItem = false) {
  const mk = (i) => (name) => ({ all: () => refs[name], first: () => refs[name][0], item: refs[name][i], itemMatching: (k) => refs[name][k] });
  const fn = new AF('$input', '$json', '$', '$now', '$execution', 'DateTime', code(file));
  if (eachItem) {
    const out = [];
    for (let i = 0; i < input.length; i++) out.push(await fn({ all: () => input, item: input[i] }, input[i].json, mk(i), DateTime.now(), { id: '999' }, DateTime));
    return out;
  }
  return fn({ all: () => input, first: () => input[0] }, input[0] && input[0].json, mk(0), DateTime.now(), { id: '999' }, DateTime);
}
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

(async () => {
  const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const key = Array.isArray(raw) ? raw : raw.cases;
  const loc = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).company.locations;
  const SHIP = { T01: 'larimer', T02: 'highlands', T03: 'larimer', T04: null, T06: 'washpark', T07: 'larimer', T08: 'highlands', T09: null, T10: 'washpark', T11: 'larimer', T12: 'washpark' };
  const [cfgItem] = await run('config.js', [{ json: {}, binary: {} }]);
  const config = cfgItem.json.config;
  const reading = (k) => ({ is_invoice: true, invoice_number: k.invoice_number, supplier_name: k.supplier, invoice_date: k.invoice_date, due_date: k.due_date,
    currency: k.currency, subtotal: Number(k.subtotal), tax: Number(k.tax), total: Number(k.total), ship_to: SHIP[k.case_id] ? loc[SHIP[k.case_id]] : null,
    line_items: k.line_items.map((l) => ({ ...l, category: 'packaging' })) });
  const email = (k, extra = {}) => ({ json: { source: 'gmail', file_name: k.file_name, email_id: 'm1', sender: 'ap.test@example.com', sender_name: 'AP Test',
    subject: 'Invoices', received_at: '2026-10-28T09:30:00.000Z', prior_dup_keys: [], config, reading: reading(k), ai_failed: false, ...extra }, binary: { data: { fileName: k.file_name } } });
  const decide = async (items, airtable = [{ json: {} }]) => {
    const checked = await run('check_allocate.js', items);
    return run('decide_route.js', airtable, { 'Check & Allocate': checked });
  };
  const byId = (id) => key.find((k) => k.case_id === id);

  const decided = await decide([email(byId('T04')), email(byId('T08')), email(byId('T09')), email(byId('T10')), email(byId('T03'))]);
  const prepared = await run('prepare_record.js', decided);
  const [t04, t08, t09, t10, t03] = prepared.map((p) => p.json);
  console.log('\n--- problem texts (read them) ---');
  for (const p of [t08, t09, t10]) console.log(`[${p.case_id || p.file_name}]\n${p.problem_text}\n`);

  ok(t04.record.drive_file_name === 'BrightClean Commercial Services_BC-2026-0412.pdf', `T04 file name: ${t04.record.drive_file_name}`);
  ok(t10.record.drive_file_name === 'Meadow Dairy_no-number_2026-10-16.pdf', `T10 file name (no number): ${t10.record.drive_file_name}`);
  ok(t04.record.invoice_fields.Status === 'Recorded' && !('Problem' in t04.record.invoice_fields) && !('Review reasons' in t04.record.invoice_fields), 'T04 Recorded, no problem, no reasons');
  ok(!('Ship-to branch' in t04.record.invoice_fields), 'T04 has no ship-to branch (no delivery block)');
  ok(t08.record.invoice_fields.Status === 'Needs Review' && t08.record.invoice_fields['Review reasons'][0] === 'sum_mismatch' && t08.record.invoice_fields['Ship-to branch'] === 'Highlands', 'T08 Needs Review, sum_mismatch, Highlands');
  ok(/\$1,240\.00, but the invoice states a subtotal of \$1,420\.00 \(\$180\.00 difference\)/.test(t08.problem_text), 'T08 problem statement has the real numbers');
  ok(/due date \(Sep 14, 2026\) is before the invoice date \(Oct 14, 2026\)/.test(t09.problem_text), 'T09 dates written as Sep 14, 2026');
  ok(t10.record.invoice_fields['Invoice number'] === undefined && /No invoice number was found/.test(t10.problem_text), 'T10 no invoice number field, problem explains why it matters');
  ok(t04.record.line_fields.map((l) => l.Branch).join() === 'Larimer St,Highlands,Wash Park,Larimer St,Highlands', 'T04 line branches by name');
  ok(t04.record.line_fields[0].Category === 'To-Go Packaging & Disposables' && t04.record.line_fields[0]['Line no'] === 1, 'line category by name, line numbers');
  ok(t09.record.line_fields[0].Branch === 'Shared', 'T09 line 1 Shared');
  ok(t04.record.invoice_fields.Source === 'AP Test <ap.test@example.com> · "Invoices"' && t04.record.invoice_fields['Dup key'] === 'brightclean commercial services|BC-2026-0412', 'source and dup key');
  ok(prepared.every((p) => p.binary && p.binary.data), 'PDF kept for the Drive upload');

  const noSubj = await run('prepare_record.js', await decide([email(byId('T04'), { subject: '' })]));
  ok(noSubj[0].json.record.invoice_fields.Source === 'AP Test <ap.test@example.com> · (no subject)', 'empty subject written as (no subject)');

  // multi-reason text
  const multi = await decide([email(byId('T01'), { reading: { ...reading(byId('T01')), total: 800, due_date: '2026-09-01', currency: 'CAD' } })]);
  const [m] = await run('prepare_record.js', multi);
  console.log(`[multi]\n${m.json.problem_text}\n`);
  ok(/^1\. Problem: .*\n   Why it was flagged: .*\n   What to check: .*\n2\. Problem/.test(m.json.problem_text) && m.json.problems.length === 3, 'several reasons are numbered, each with why and what to check');
  ok(/^Problem: .*\nWhy it was flagged: Invoices are only recorded when the lines, tax and total agree\.\nWhat to check: Open the PDF/.test(t08.problem_text), 'T08: problem, why, what to check (design doc section 6)');

  // Drive output -> Invoice Request -> (Airtable reply) -> Line Item Requests
  const drive = prepared.map((p, i) => ({ json: { id: 'driveFile' + i, name: p.json.record.drive_file_name } }));
  const reqs = await run('invoice_request.js', drive, { 'Prepare Record': prepared }, true);
  const body = reqs[0].json.body;
  ok(body.typecast === true && body.records[0].fields.PDF === 'https://drive.google.com/file/d/driveFile0/view' && body.records[0].fields['Execution ID'] === '999', 'invoice request: PDF link and execution ID');
  const airtableReplies = prepared.map((p, i) => ({ json: { records: [{ id: 'recINV' + i, fields: {} }] } }));
  const lineReqs = await run('line_item_requests.js', airtableReplies, { 'Prepare Record': prepared });
  const forT03 = lineReqs.filter((r) => r.json.invoice_record_id === 'recINV4');
  ok(forT03.length === 3 && forT03.map((r) => r.json.body.records.length).join() === '10,10,1', 'T03 21 lines -> 3 requests (10, 10, 1)');
  ok(lineReqs.filter((r) => r.json.invoice_record_id === 'recINV0').length === 1 && lineReqs[0].json.body.records[0].fields.Invoice[0] === 'recINV0', 'T04 5 lines -> 1 request, linked to its invoice');
  ok(lineReqs.length === 1 + 1 + 1 + 1 + 3, 'total line requests across 5 invoices = 7');
  const noLines = await run('line_item_requests.js', [{ json: { records: [{ id: 'recX' }] } }], { 'Prepare Record': [{ json: { record: { line_fields: [] } } }] });
  ok(noLines.length === 0, 'invoice without lines sends no line request');

  console.log(`\n${fails} problem(s)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
