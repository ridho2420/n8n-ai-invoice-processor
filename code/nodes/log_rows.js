// Stage 7b: one row in the data table p3_processing_log for every document from the inbox.
// The same code runs in three places and recognises where it is from its input:
//   - after To Record? "false": duplicates, non-invoices and errors (nothing recorded)
//   - after Create Invoice Record: needs-review invoices (Airtable record, Drive link)
//   - after Attachment Check: recorded invoices (plus QuickBooks bill and attachment result)
// duration_ms runs from the start of reading (Read Path) to this row.
const now = Date.now();
const str = (v) => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function row(j, extra) {
  const inv = j.invoice || {};
  return {
    received_at: str(j.received_at),
    mode: str(j.source),
    run_id: str(j.run_id),
    case_id: str(j.case_id),
    email_id: str(j.email_id),
    sender: str(j.sender ? `${j.sender_name ? j.sender_name + ' ' : ''}<${j.sender}>` : null),
    subject: str(j.subject),
    file_name: str(j.file_name),
    read_path: str(j.read_path),
    route: str(j.route),
    reasons: str((j.reasons || []).join(', ')),
    supplier: str((j.vendor && j.vendor.name) || inv.supplier),
    invoice_number: str(inv.invoice_number),
    total: num(inv.total),
    dup_key: str(j.dup_key),
    extracted: j.reading ? JSON.stringify(j.reading) : null,
    airtable_id: null,
    quickbooks_bill_id: null,
    drive_url: null,
    error_step: str(j.error_step),
    error_message: str(j.error_message),
    duration_ms: j.read_started_at ? now - j.read_started_at : null,
    execution_id: String($execution.id),
    ...extra,
  };
}

const items = $input.all();
const first = items.length ? items[0].json : {};
const out = [];

if (first.attachments) {
  // Recorded invoices: one Bill Requests item per bill, in the same order as Create Bill.
  const prepared = $('Prepare Record').all().map((p) => p.json);
  const bills = $('Create Bill').all().map((b) => b.json.Bill || {});
  const records = $('Create Invoice Record').all().map((c) => (c.json.records || [])[0]).filter(Boolean);
  const attachments = first.attachments;
  $('Bill Requests').all().forEach((reqItem, i) => {
    const req = reqItem.json;
    const j = prepared.find((p) => p.dup_key === req.dup_key);
    if (!j) return;
    const bill = bills[i] || {};
    const record = records.find((r) => r.id === req.airtable_record_id) || { fields: {} };
    const att = attachments.find((a) => a.bill_id === String(bill.Id)) || null;
    out.push(row(j, {
      airtable_id: req.airtable_record_id,
      quickbooks_bill_id: str(bill.Id),
      drive_url: str(record.fields.PDF),
      error_step: att && !att.ok ? 'attach_pdf' : null,
      error_message: att && !att.ok ? str(att.error) : null,
    }));
  });
} else if (first.records) {
  // Needs-review invoices, right after their Airtable record was created.
  items.forEach((item, i) => {
    const record = (item.json.records || [])[0];
    const j = $('Prepare Record').itemMatching(i).json;
    if (!record || j.route !== 'needs_review') return;
    out.push(row(j, { airtable_id: record.id, drive_url: str(record.fields.PDF) }));
  });
} else {
  // Not recorded on purpose (duplicate, not an invoice) or failed (error).
  items.forEach((item) => out.push(row(item.json, {})));
}

return out.map((json) => ({ json }));
