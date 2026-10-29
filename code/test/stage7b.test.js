// Local tests for stage 7b (Log rows, error alerts).
// Usage: NODE_PATH=<dir with luxon> node stage7b.test.js <p3-eval-cases-v1.json> <p3-test-set-source.json>
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
const COLUMNS = ['received_at', 'mode', 'run_id', 'case_id', 'email_id', 'sender', 'subject', 'file_name', 'read_path', 'route', 'reasons', 'supplier',
  'invoice_number', 'total', 'dup_key', 'extracted', 'airtable_id', 'quickbooks_bill_id', 'drive_url', 'error_step', 'error_message', 'duration_ms', 'execution_id'];

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
  const started = Date.now() - 5000;
  const email = (k, extra = {}) => ({ json: { source: 'gmail', run_id: null, case_id: null, file_name: k ? k.file_name : 'Broken_Invoice.pdf', email_id: 'm7b', sender: 'ap.test@example.com', sender_name: 'AP Test',
    subject: 'tes 7b', received_at: '2026-10-28T13:30:00.000Z', prior_dup_keys: [], config, read_path: 'text_layer', read_started_at: started, pdf_header_ok: true,
    reading: k ? reading(k) : null, ai_failed: !k, ai_error: k ? null : 'Gemini request failed: The document has no pages.', ...extra }, binary: { data: { id: 'fs:x' } } });
  const earlierT01 = { json: { id: 'recT01xxxxxxxxxxx', fields: { 'Dup key': 'highland bean roasters|HB-10482', Total: 797, Invoice: 'Highland Bean Roasters · HB-10482', 'Received at': '2026-10-28T11:58:19.000Z', Status: 'Recorded' } } };

  const checked = await run('check_allocate.js', [email(byId('T10')), email(byId('T05')), email(byId('T11')), email(byId('T02')), email(null, { pdf_header_ok: false, read_path: 'extract_failed' })]);
  const decided = await run('decide_route.js', [earlierT01], { 'Check & Allocate': checked });
  const [d10, d05, d11, d02, dErr] = decided;
  ok([d10, d05, d11, d02, dErr].map((d) => d.json.route).join() === 'needs_review,not_invoice,duplicate,recorded,error', 'routes: needs review, not invoice, duplicate, recorded, error');

  // --- Log rows: not recorded (after To Record? "false")
  const notRecorded = (await run('log_rows.js', [d05, d11, dErr])).map((r) => r.json);
  ok(notRecorded.length === 3 && notRecorded.every((r) => COLUMNS.every((c) => c in r) && Object.keys(r).length === COLUMNS.length), 'three rows with exactly the 23 log columns');
  const [r05, r11, rErr] = notRecorded;
  ok(r05.route === 'not_invoice' && r05.supplier === null && r05.extracted.includes('"is_invoice":false') && r05.sender === 'AP Test <ap.test@example.com>', 'not invoice: route, sender, what the AI read');
  ok(r11.route === 'duplicate' && r11.supplier === 'Highland Bean Roasters' && r11.invoice_number === 'HB-10482' && r11.total === 797 && r11.dup_key === 'highland bean roasters|HB-10482', 'duplicate: supplier, number, total, key');
  ok(rErr.route === 'error' && rErr.error_step === 'read' && /no pages/.test(rErr.error_message) && rErr.extracted === null && rErr.read_path === 'extract_failed', 'error: step, message, read path');
  ok(rErr.duration_ms >= 5000 && rErr.duration_ms < 7000 && rErr.execution_id === '999' && rErr.received_at === '2026-10-28T13:30:00.000Z' && rErr.mode === 'gmail', 'duration from start of reading, execution ID, received time');

  // --- Log rows: needs review (after Create Invoice Record)
  const withVendor = [d10, d02].map((d) => ({ ...d, json: { ...d.json, vendor: { id: '59', name: 'Meadow Dairy Co.', match: 'one' } } }));
  const prepared = await run('prepare_record.js', withVendor);
  const created = prepared.map((p, i) => ({ json: { records: [{ id: 'recNEW' + i, fields: { PDF: 'https://drive.google.com/file/d/f' + i + '/view', 'Dup key': p.json.dup_key } }] } }));
  const review = (await run('log_rows.js', created, { 'Prepare Record': prepared })).map((r) => r.json);
  ok(review.length === 1 && review[0].route === 'needs_review' && review[0].reasons === 'missing_invoice_number' && review[0].airtable_id === 'recNEW0' && review[0].drive_url === 'https://drive.google.com/file/d/f0/view' && review[0].quickbooks_bill_id === null, 'needs review: only T10, with record and Drive link, no bill');

  // --- Log rows: recorded (after Attachment Check)
  const billReqs = await run('bill_requests.js', [{ json: {} }], { 'Prepare Record': prepared, 'Create Invoice Record': created });
  const createBill = billReqs.map((b, i) => ({ json: { Bill: { Id: String(150 + i), DocNumber: b.json.body.DocNumber, TotalAmt: b.json.expected_total } } }));
  const attOk = { json: { attachments: [{ bill_id: '150', invoice_number: 'INV-2041', file_name: 'Meadow Dairy_INV-2041.pdf', ok: true, error: null }], attached: 1, failed: 0 } };
  const refs = { 'Prepare Record': prepared, 'Create Invoice Record': created, 'Bill Requests': billReqs, 'Create Bill': createBill };
  const [rec] = (await run('log_rows.js', [attOk], refs)).map((r) => r.json);
  ok(billReqs.length === 1 && rec.route === 'recorded' && rec.quickbooks_bill_id === '150' && rec.airtable_id === 'recNEW1' && rec.drive_url === 'https://drive.google.com/file/d/f1/view' && rec.error_step === null, 'recorded: bill ID, record, Drive link, no error');
  const attBad = { json: { attachments: [{ bill_id: '150', invoice_number: 'INV-2041', file_name: 'Meadow Dairy_INV-2041.pdf', ok: false, error: '400 - Bad request' }], attached: 0, failed: 1 } };
  const [recBad] = (await run('log_rows.js', [attBad], refs)).map((r) => r.json);
  ok(recBad.error_step === 'attach_pdf' && recBad.error_message === '400 - Bad request' && recBad.quickbooks_bill_id === '150', 'failed attachment is logged on the recorded row');

  // --- Error alerts
  const alerts = (await run('error_alerts.js', [d05, d11, dErr])).map((a) => a.json);
  console.log('\n--- alert (not a PDF) ---\n' + (alerts[0] || {}).text + '\n');
  ok(alerts.length === 1 && alerts[0].kind === 'read', 'only the error document gets an alert');
  const lines = alerts[0].text.split('\n');
  ok(lines[0] === '🛑 Reading the invoice failed for Broken_Invoice.pdf from AP Test &lt;ap.test@example.com&gt;.' && lines[1] === 'Impact: this invoice was not recorded.'
    && lines[2] === 'Saved: the email is still in the inbox, and the attempt is in the processing log (execution 999).', 'what failed, impact, what is saved');
  ok(/not a real PDF/.test(lines[3]) && lines[4] === 'Error: Gemini request failed: The document has no pages.', 'not-a-PDF hint and the error text');
  const realPdfFail = { json: { ...dErr.json, pdf_header_ok: true } };
  const [geminiAlert] = await run('error_alerts.js', [realPdfFail]);
  ok(/check the Gemini API key, the model name and the quota/.test(geminiAlert.json.text), 'a real PDF with an unknown failure points to the Gemini settings');
  const hint = async (msg) => (await run('error_alerts.js', [{ json: { ...dErr.json, pdf_header_ok: true, error_message: msg } }]))[0].json.text.split('\n')[3];
  ok(/Gemini was busy or unreachable/.test(await hint('Gemini request failed: Service unavailable - try again later or consider setting this node to retry automatically (in the node settings)')), '503 (seen in execution 413): busy, forward again later');
  ok(/quota or rate limit/.test(await hint('Gemini request failed: The service is receiving too many requests from you')), '429: quota or rate limit');
  ok(/check the Gemini API key in the n8n credential/.test(await hint('Gemini request failed: Authorization failed - please check your credentials')), '401: API key');
  ok(/not in the expected format/.test(await hint('Gemini reply was not valid JSON (finishReason MAX_TOKENS)')), 'bad JSON: forward again or enter by hand');
  ok(/not a real PDF/.test((await run('error_alerts.js', [{ json: { ...dErr.json, error_message: 'Service unavailable' } }]))[0].json.text), 'not-a-PDF wins over the error text');
  const [attAlert] = await run('error_alerts.js', [attBad]);
  console.log('--- alert (attachment) ---\n' + attAlert.json.text + '\n');
  ok(attAlert.json.kind === 'attach_pdf' && attAlert.json.text.startsWith('🛑 Attaching the PDF to QuickBooks bill 150 failed (INV-2041, Meadow Dairy_INV-2041.pdf).') && /Error: 400 - Bad request$/.test(attAlert.json.text), 'attachment alert names the bill, invoice and error');
  ok((await run('error_alerts.js', [attOk])).length === 0, 'no alert when every PDF was attached');

  console.log(`\n${fails} problem(s)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
