// Stage 7b: technical problems go to #automation-errors (not #invoice-review), written by code:
// what failed, what it means, what is saved, and what to do next.
// The same code runs in two places and recognises where it is from its input:
//   - after To Record? "false": documents with route "error" (the reading failed)
//   - after Attachment Check: PDFs that did not reach their QuickBooks bill
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const short = (s, n = 300) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const exec = `execution ${$execution.id}`;

// What to do next after a failed reading depends on the kind of failure.
function readingNext(j) {
  const err = String(j.error_message || j.ai_error || '');
  if (j.pdf_header_ok === false) return 'Next: the file is not a real PDF (it does not start with %PDF). Ask the sender for the invoice as a PDF, then forward it again.';
  if (/unavailable|overloaded|503|timed? ?out|ECONNRESET|socket hang up/i.test(err)) return 'Next: Gemini was busy or unreachable for a moment; the invoice itself is fine. Forward the email again in a few minutes.';
  if (/too many requests|429|quota|rate limit|RESOURCE_EXHAUSTED/i.test(err)) return 'Next: the Gemini quota or rate limit was reached. Forward the email again in a few minutes; if it keeps happening, check the quota of the API key.';
  if (/authoriz|forbidden|401|403|api key|credential/i.test(err)) return 'Next: check the Gemini API key in the n8n credential, then forward the email again.';
  if (/not valid JSON|no text|not an object/i.test(err)) return 'Next: Gemini answered, but not in the expected format. Forward the email again; if it fails twice, enter the invoice by hand.';
  return 'Next: check the Gemini API key, the model name and the quota in n8n, then forward the email again.';
}

const items = $input.all();
const first = items.length ? items[0].json : {};
const out = [];

if (first.attachments) {
  for (const a of first.attachments.filter((x) => !x.ok)) {
    out.push({ json: { kind: 'attach_pdf', text: [
      `🛑 Attaching the PDF to QuickBooks bill ${esc(a.bill_id)} failed (${esc(a.invoice_number)}, ${esc(a.file_name)}).`,
      'Impact: the bill was created, but it has no PDF attached.',
      `Saved: the PDF is in the Drive folder Invoices, and the attempt is in the processing log (${exec}).`,
      'Next: attach the PDF to the bill by hand in QuickBooks. If it keeps failing, check the QuickBooks login (Sandbox environment) in n8n.',
      `Error: ${esc(short(a.error || 'unknown'))}`,
    ].join('\n') } });
  }
} else {
  for (const item of items) {
    const j = item.json;
    if (j.route !== 'error') continue;
    const from = esc(`${j.sender_name ? j.sender_name + ' ' : ''}<${j.sender}>`);
    out.push({ json: { kind: 'read', file_name: j.file_name, text: [
      `🛑 Reading the invoice failed for ${esc(j.file_name)} from ${from}.`,
      'Impact: this invoice was not recorded.',
      `Saved: the email is still in the inbox, and the attempt is in the processing log (${exec}).`,
      readingNext(j),
      `Error: ${esc(short(j.error_message || j.ai_error || 'unknown'))}`,
    ].join('\n') } });
  }
}
return out;
