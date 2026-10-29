// Line Items for each new Invoice record, 10 per request (Airtable's limit per call),
// each linked to its invoice. An invoice without lines sends nothing here.
const out = [];
$input.all().forEach((item, i) => {
  const created = (item.json.records || [])[0];
  const rec = $('Prepare Record').itemMatching(i).json;
  if (!created || !created.id) return;
  const lines = rec.record.line_fields || [];
  for (let start = 0; start < lines.length; start += 10) {
    out.push({
      json: {
        invoice_record_id: created.id,
        dup_key: rec.dup_key,
        lines_from: start + 1,
        lines_to: Math.min(start + 10, lines.length),
        body: {
          typecast: true,
          records: lines.slice(start, start + 10).map((f) => ({ fields: { ...f, 'Invoice': [created.id] } })),
        },
      },
    });
  }
});
return out;
