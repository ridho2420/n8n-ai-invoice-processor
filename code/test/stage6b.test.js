// Local tests for stage 6b-1 (Config QuickBooks block, Match Vendor, Prepare Record with
// vendor names, Bill Requests, Bill ID Updates).
// Usage: NODE_PATH=<dir with luxon> node stage6b.test.js <p3-eval-cases-v1.json> <p3-test-set-source.json>
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
const throwsWith = async (fn, re) => { try { await fn(); return false; } catch (e) { return re.test(e.message); } };

(async () => {
  const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const key = Array.isArray(raw) ? raw : raw.cases;
  const loc = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).company.locations;
  const SHIP = { T01: 'larimer', T02: 'highlands', T03: 'larimer', T04: null, T06: 'washpark', T07: 'larimer', T08: 'highlands', T09: null, T10: 'washpark', T11: 'larimer', T12: 'washpark' };
  const cat = (d) => (/freight|delivery/i.test(d) ? 'freight' : /glove|towel|label/i.test(d) ? 'supplies' : /janitorial|cleaning|strip|shampoo/i.test(d) ? 'cleaning_services'
    : /blend|origin|decaf|brew/i.test(d) ? 'coffee_tea' : /milk|cream|half/i.test(d) ? 'dairy' : 'packaging');
  const [cfgItem] = await run('config.js', [{ json: {}, binary: {} }]);
  const config = cfgItem.json.config;
  const reading = (k, supplier) => ({ is_invoice: true, invoice_number: k.invoice_number, supplier_name: supplier || k.supplier, invoice_date: k.invoice_date, due_date: k.due_date,
    currency: k.currency, subtotal: Number(k.subtotal), tax: Number(k.tax), total: Number(k.total), ship_to: SHIP[k.case_id] ? loc[SHIP[k.case_id]] : null,
    line_items: k.line_items.map((l) => ({ ...l, category: cat(l.description) })) });
  const email = (k, extra = {}) => ({ json: { source: 'gmail', file_name: k.file_name, email_id: 'm1', sender: 'ap.test@example.com', sender_name: 'AP Test',
    subject: 'Invoices', received_at: '2026-10-28T09:30:00.000Z', prior_dup_keys: [], config, reading: reading(k), ai_failed: false, ...extra }, binary: { data: { fileName: k.file_name } } });
  const byId = (id) => key.find((k) => k.case_id === id);
  const decide = async (items) => {
    const checked = await run('check_allocate.js', items);
    return run('decide_route.js', [{ json: {} }], { 'Check & Allocate': checked });
  };
  const V = (Id, DisplayName, CompanyName) => ({ Id, DisplayName, CompanyName });
  const vendorReply = { QueryResponse: { Vendor: [
    V('58', 'Highland Bean Roasters', 'Highland Bean Roasters LLC'), V('59', 'Meadow Dairy Co.', 'Meadow Dairy Co.'),
    V('60', 'PackRight Packaging Supply', 'PackRight Packaging Supply, Inc.'), V('61', 'BrightClean Commercial Services', 'BrightClean Commercial Services LLC'),
    V('1', 'Brosnahan Insurance Agency', 'Brosnahan Insurance Agency'), V('7', "Cal Telephone", "Cal Telephone"),
  ] } };

  // --- Config
  ok(config.categories.every((c) => config.quickbooks.accounts[c.code]) && config.branches.every((b) => config.quickbooks.classes[b.code]),
    'Config: every category has an account and every store a Class');

  // --- Match Vendor
  const t04 = email(byId('T04'), { reading: reading(byId('T04'), 'BrightClean Commercial Services LLC') });
  const t03 = email(byId('T03'), { reading: reading(byId('T03'), 'PackRight Packaging Supply, Inc.') });
  const unknown = email(byId('T01'), { reading: reading(byId('T01'), 'Mountain Ice Company') });
  const decided = await decide([email(byId('T01')), t03, t04, email(byId('T09'))]);
  const decidedUnknown = await decide([unknown]);
  const toRecord = [...decided, ...decidedUnknown];
  ok(toRecord.map((d) => d.json.route).join() === 'recorded,recorded,recorded,needs_review,recorded', 'routes before vendor match: 4 recorded, T09 needs review');
  const matched = await run('match_vendor.js', [{ json: {} }], { 'Find QuickBooks Vendors': [{ json: vendorReply }], 'To Record?': toRecord });
  const [m01, m03, m04, m09, mUnknown] = matched.map((m) => m.json);
  ok(m01.vendor.id === '58' && m03.vendor.id === '60' && m04.vendor.id === '61' && m09.vendor.id === '61', 'vendors 58, 60 (", Inc."), 61 ("LLC"), 61 for T09');
  ok(m03.route === 'recorded' && m03.reasons.length === 0, 'matched invoice keeps its route');
  ok(mUnknown.route === 'needs_review' && mUnknown.reasons.join() === 'vendor_not_in_quickbooks' && mUnknown.vendor.match === 'none', 'unknown supplier -> needs review, vendor_not_in_quickbooks');
  ok(m09.reasons.join() === 'due_before_invoice', 'needs-review invoice with a known vendor gets no extra reason');
  ok(matched.every((m) => m.binary && m.binary.data), 'PDF kept');
  const twice = { QueryResponse: { Vendor: [...vendorReply.QueryResponse.Vendor, V('70', 'Meadow Dairy', 'Meadow Dairy LLC')] } };
  const [several] = await run('match_vendor.js', [{ json: {} }], { 'Find QuickBooks Vendors': [{ json: twice }], 'To Record?': await decide([email(byId('T02'))]) });
  ok(several.json.vendor.match === 'several' && several.json.details.vendor_not_in_quickbooks.matches.length === 2, 'two vendors match -> several, not recorded');
  const [none] = await run('match_vendor.js', [{ json: {} }], { 'Find QuickBooks Vendors': [{ json: {} }], 'To Record?': await decide([email(byId('T02'))]) });
  ok(none.json.vendor.match === 'none' && none.json.vendors_checked === 0, 'empty vendor list -> no match');

  // --- Prepare Record with vendor names
  const prepared = await run('prepare_record.js', [...matched, several]);
  const [p01, p03, p04, p09, pUnknown, pSeveral] = prepared.map((p) => p.json);
  ok(p03.record.invoice_fields.Supplier === 'PackRight Packaging Supply' && p03.record.drive_file_name === 'PackRight Packaging Supply_INV-2036.pdf', 'Supplier and file name use the QuickBooks vendor name');
  ok(p04.record.invoice_fields.Supplier === 'BrightClean Commercial Services', 'T04 Supplier without LLC');
  ok(pUnknown.record.invoice_fields.Supplier === 'Mountain Ice Company' && pUnknown.record.invoice_fields.Status === 'Needs Review', 'unknown supplier keeps the printed name, Needs Review');
  ok(/^Problem: Mountain Ice Company is not set up as a vendor in QuickBooks, so no bill was created\.\nWhy it was flagged: Bills are only created for vendors that already exist in QuickBooks, so no duplicate vendors are made\.\nWhat to check: Add the vendor in QuickBooks/.test(pUnknown.problem_text), 'problem text for a missing vendor');
  ok(/matches more than one vendor in QuickBooks \(Meadow Dairy Co\., Meadow Dairy\)/.test(pSeveral.problem_text), 'problem text names both vendors');
  console.log(`\n[missing vendor]\n${pUnknown.problem_text}\n[two vendors]\n${pSeveral.problem_text}\n`);

  // --- Drive -> Airtable reply -> Bill Requests
  const airtableReplies = prepared.map((p, i) => ({ json: { records: [{ id: 'recINV' + i, fields: { 'Dup key': p.json.dup_key, PDF: 'https://drive.google.com/file/d/f' + i + '/view' } }] } }));
  const billReqs = (await run('bill_requests.js', [{ json: {} }], { 'Prepare Record': prepared, 'Create Invoice Record': airtableReplies })).map((b) => b.json);
  ok(billReqs.map((b) => b.invoice_number).join() === 'HB-10482,INV-2036,BC-2026-0412', 'bills only for the 3 recorded invoices (not T09, not the unknown vendors)');
  const b04 = billReqs[2].body;
  ok(b04.VendorRef.value === '61' && b04.DocNumber === 'BC-2026-0412' && b04.TxnDate === '2026-10-01' && b04.DueDate === '2026-10-31', 'T04 vendor, number and dates');
  ok(b04.Line.map((l) => l.AccountBasedExpenseLineDetail.ClassRef.value).join() === '741030,741031,741032,741030,741031', 'T04 lines split over 3 Classes (Larimer, Highlands, Wash Park)');
  ok(b04.Line.every((l) => l.AccountBasedExpenseLineDetail.AccountRef.value === '1150040004') && b04.Line.length === 5, 'T04 5 lines on Cleaning & Maintenance Services, no tax line (tax 0)');
  const b03 = billReqs[1];
  const tax = b03.body.Line[21];
  ok(b03.body.Line.length === 22 && tax.Description === 'Sales tax' && tax.Amount === 194.43 && tax.AccountBasedExpenseLineDetail.AccountRef.value === '1150040007' && tax.AccountBasedExpenseLineDetail.ClassRef.value === '741030', 'T03 21 lines + tax line (Sales Tax Paid, Larimer St)');
  ok(b03.expected_total === 2551.13 && b03.printed_total === 2551.13 && billReqs[0].expected_total === 797, 'bill totals equal the invoice totals (2,551.13 and 797.00)');
  ok(new Set(b03.body.Line.map((l) => l.AccountBasedExpenseLineDetail.AccountRef.value)).size === 4, 'T03 uses 4 accounts (packaging, supplies, freight, tax)');
  ok(/Airtable record recINV1\.\nPDF: https:\/\/drive\.google\.com\/file\/d\/f1\/view\nn8n execution 999\./.test(b03.body.PrivateNote), 'private note names the Airtable record, PDF and execution');
  ok(b03.bill_url === 'https://sandbox-quickbooks.api.intuit.com/v3/company/YOUR_QUICKBOOKS_COMPANY_ID/bill?minorversion=75', 'bill URL from Config');

  // long invoice number
  const longNo = JSON.parse(JSON.stringify(prepared[0]));
  longNo.json.invoice.invoice_number = 'HB-2026-10482-REPRINT-COPY';
  longNo.json.dup_key = 'x|long';
  const [bLong] = await run('bill_requests.js', [{ json: {} }], { 'Prepare Record': [longNo], 'Create Invoice Record': [{ json: { records: [{ id: 'recL', fields: { 'Dup key': 'x|long' } }] } }] });
  ok(bLong.json.body.DocNumber === 'HB-2026-10482-REPRINT' && /shortened/.test(bLong.json.body.PrivateNote), 'number longer than 21 characters is shortened and noted');

  // missing Class -> clear error instead of a bad bill
  const noClass = JSON.parse(JSON.stringify(prepared[0]));
  noClass.json.config.quickbooks.classes = {};
  ok(await throwsWith(() => run('bill_requests.js', [{ json: {} }], { 'Prepare Record': [noClass], 'Create Invoice Record': [airtableReplies[0]] }), /No QuickBooks account or Class for HB-10482 line 1/), 'missing Class stops with a clear message');

  // --- Bill ID Updates
  const billItems = billReqs.map((b) => ({ json: b }));
  const qbReplies = billReqs.map((b, i) => ({ json: { Bill: { Id: String(140 + i), TotalAmt: i === 0 ? b.expected_total + 1 : b.expected_total } } }));
  const [upd] = await run('bill_id_updates.js', qbReplies, { 'Bill Requests': billItems });
  ok(upd.json.body.records.length === 3 && upd.json.body.records[1].id === 'recINV1' && upd.json.body.records[1].fields['QuickBooks bill'] === '141', 'bill IDs go to the right Airtable records');
  ok(upd.json.bills[0].total_ok === false && upd.json.bills[1].total_ok === true, 'a QuickBooks total that differs is flagged');
  const many = Array.from({ length: 12 }, (_, i) => ({ json: { airtable_record_id: 'r' + i, invoice_number: 'N' + i, expected_total: 1, printed_total: 1 } }));
  const manyOut = await run('bill_id_updates.js', many.map((m, i) => ({ json: { Bill: { Id: 'B' + i, TotalAmt: 1 } } })), { 'Bill Requests': many });
  ok(manyOut.length === 2 && manyOut[0].json.body.records.length === 10 && manyOut[1].json.body.records.length === 2, '12 bills -> 2 Airtable requests (10 + 2)');

  // --- 6b-2: Attachment Requests
  const preparedWithPdf = prepared.map((p) => ({ ...p, binary: { data: { id: 'filesystem-v2:x/' + p.json.file_name, mimeType: 'application/pdf', fileName: p.json.file_name } } }));
  const createBill = billReqs.map((b, i) => ({ json: { Bill: { Id: String(145 + i), DocNumber: b.body.DocNumber, TotalAmt: b.expected_total } } }));
  const att = await run('attachment_requests.js', [{ json: {} }], { 'Prepare Record': preparedWithPdf, 'Bill Requests': billItems, 'Create Bill': createBill });
  ok(att.length === 3 && att[1].json.bill_id === '146' && att[1].json.upload_url === 'https://sandbox-quickbooks.api.intuit.com/v3/company/YOUR_QUICKBOOKS_COMPANY_ID/upload?minorversion=75', 'one upload per bill, upload URL from Config');
  const meta = JSON.parse(Buffer.from(att[1].binary.meta.data, 'base64').toString('utf8'));
  ok(meta.AttachableRef[0].EntityRef.type === 'Bill' && meta.AttachableRef[0].EntityRef.value === '146' && meta.FileName === 'PackRight Packaging Supply_INV-2036.pdf' && meta.ContentType === 'application/pdf', 'metadata points at the bill, with the Drive file name');
  ok(att[1].binary.meta.mimeType === 'application/json' && att[1].binary.file.mimeType === 'application/pdf' && att[1].binary.file.id === 'filesystem-v2:x/PackRight_INV-2036.pdf' && att[1].binary.file.fileName === 'PackRight Packaging Supply_INV-2036.pdf', 'two parts: JSON metadata and the original PDF, renamed');
  const swapped = [createBill[1], createBill[0], createBill[2]];
  ok(await throwsWith(() => run('attachment_requests.js', [{ json: {} }], { 'Prepare Record': preparedWithPdf, 'Bill Requests': billItems, 'Create Bill': swapped }), /has number INV-2036, but request 1 was for HB-10482/), 'a bill paired with the wrong request stops the run');
  const accented = JSON.parse(JSON.stringify(preparedWithPdf));
  accented[0].json.record.drive_file_name = 'Café Señor_HB-10482.pdf';
  const [accAtt] = await run('attachment_requests.js', [{ json: {} }], { 'Prepare Record': accented, 'Bill Requests': billItems, 'Create Bill': createBill });
  ok(JSON.parse(Buffer.from(accAtt.binary.meta.data, 'base64').toString('utf8')).FileName === 'Café Señor_HB-10482.pdf', 'accented file names survive the metadata');

  // --- 6b-2: Attachment Check
  const replies = [
    { json: { AttachableResponse: [{ Attachable: { Id: '5000000000000123', Size: 3365 } }] } },
    { json: { error: { message: '400 - Bad request' } } },
    { json: { AttachableResponse: [{ Fault: { Error: [{ Message: 'Invalid ContentType' }] } }] } },
  ];
  const [chk] = await run('attachment_check.js', replies, { 'Attachment Requests': att });
  ok(chk.json.attached === 1 && chk.json.failed === 2 && chk.json.attachments[0].attachable_id === '5000000000000123' && chk.json.attachments[0].size === 3365, 'successful upload recorded with its attachment ID');
  ok(chk.json.attachments[1].error === '400 - Bad request' && /Invalid ContentType/.test(chk.json.attachments[2].error) && chk.json.attachments[2].bill_id === '147', 'failed uploads listed with the reason and bill');

  console.log(`\n${fails} problem(s)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
