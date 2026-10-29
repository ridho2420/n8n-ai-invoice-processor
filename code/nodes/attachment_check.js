// Stage 6b-2: did each PDF reach its bill? A failed upload does not stop the run (the bill
// and the Airtable record already exist); it is listed here so stage 7 can report it.
const results = $input.all().map((item, i) => {
  const req = $('Attachment Requests').itemMatching(i).json;
  const res = (item.json.AttachableResponse || [])[0] || {};
  const att = res.Attachable;
  const fault = res.Fault || item.json.Fault;
  const err = item.json.error;
  const ok = !!(att && att.Id);
  return {
    bill_id: req.bill_id,
    invoice_number: req.invoice_number,
    file_name: req.file_name,
    attachable_id: ok ? String(att.Id) : null,
    size: ok && att.Size !== undefined ? Number(att.Size) : null,
    ok,
    error: ok ? null : (err ? (err.message || JSON.stringify(err)) : fault ? JSON.stringify(fault) : 'No attachment in the QuickBooks reply'),
  };
});
return [{ json: { attachments: results, attached: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } }];
