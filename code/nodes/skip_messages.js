// Stage 7a: a short Slack note for every document that was not recorded on purpose,
// so nothing disappears silently: duplicates (with a link to the record that was kept)
// and documents that are not invoices. Errors are reported in stage 7b.
const AIRTABLE_RECORD_URL = 'https://airtable.com/YOUR_AIRTABLE_BASE_ID/YOUR_INVOICES_TABLE_ID/';
const money = (n) => (n === null || n === undefined ? 'unknown total' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = (d, zone) => {
  if (!d) return null;
  const dt = String(d).length > 10 ? DateTime.fromISO(String(d)).setZone(zone) : DateTime.fromISO(String(d));
  return dt.isValid ? dt.toFormat('LLL d, yyyy') : String(d);
};

const out = [];
for (const item of $input.all()) {
  const j = item.json;
  const zone = (j.config && j.config.timezone) || 'America/Denver';
  const from = `${j.sender_name ? j.sender_name + ' ' : ''}<${j.sender}>`;
  let text = null;

  if (j.route === 'duplicate') {
    const inv = j.invoice || {};
    const d = j.duplicate_of || {};
    const what = `${inv.supplier || 'Unknown supplier'} · ${inv.invoice_number || 'no invoice number'}`;
    const due = inv.due_date ? ` It's due ${day(inv.due_date, zone)}.` : '';
    if (d.where === 'airtable') {
      const when = d.recorded_at ? ` on ${day(d.recorded_at, zone)}` : '';
      text = `🔁 Duplicate skipped: ${esc(d.label || what)} · ${money(inv.total)} was already recorded${when} (<${AIRTABLE_RECORD_URL}${d.ref}|Airtable record>). Nothing was added.${due}`;
    } else {
      text = `🔁 Duplicate skipped: ${esc(what)} · ${money(inv.total)} is the same invoice as ${esc(d.ref || 'another file')} in this email. Only one copy was recorded.${due}`;
    }
  } else if (j.route === 'not_invoice') {
    const subject = j.subject ? `"${j.subject}"` : 'no subject';
    text = `📄 Not an invoice, skipped: ${esc(j.file_name)} from ${esc(from)} (${esc(subject)}). If it is an invoice, forward it again or add it by hand.`;
  }

  if (text) out.push({ json: { kind: j.route, file_name: j.file_name, dup_key: j.dup_key || null, text } });
}
return out;
