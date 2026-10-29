// Stage 7a: one Slack message per invoice that needs review, sent after its Airtable record
// exists so the message can link to it. The text is the same problem statement as the
// Problem field in Airtable (Prepare Record), with a header and links. Written by code.
const AIRTABLE_RECORD_URL = 'https://airtable.com/YOUR_AIRTABLE_BASE_ID/YOUR_INVOICES_TABLE_ID/';
const money = (n) => (n === null || n === undefined ? 'unknown total' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
// Slack treats &, < and > as markup, so they are escaped in anything that came from a document or an email.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const out = [];
$input.all().forEach((item, i) => {
  const record = (item.json.records || [])[0];
  const rec = $('Prepare Record').itemMatching(i).json;
  if (!record || rec.route !== 'needs_review') return;
  const f = rec.record.invoice_fields;
  const header = `⚠️ Needs review: ${esc(f.Supplier || 'Unknown supplier')} · ${esc(f['Invoice number'] || 'no invoice number')} · ${money(f.Total)}`;
  const links = [
    record.fields.PDF ? `<${record.fields.PDF}|PDF>` : null,
    `<${AIRTABLE_RECORD_URL}${record.id}|Airtable record>`,
  ].filter(Boolean).join(' · ');
  out.push({
    json: {
      kind: 'needs_review',
      airtable_record_id: record.id,
      file_name: rec.file_name,
      reasons: rec.reasons,
      text: [header, esc(rec.problem_text), links].join('\n'),
    },
  });
});
return out;
