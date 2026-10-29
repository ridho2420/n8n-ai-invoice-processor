// Stage 6a: everything needed to record one invoice (routes recorded and needs_review).
// - the PDF file name for Drive: <supplier>_<invoice number>.pdf
// - the Airtable Invoices fields and the Line Items fields (written exactly, typecast on)
// - the problem statement for a person: what is wrong, why it was flagged and what to check,
//   one per reason, written by code from the reason codes (the same text goes to Slack in stage 7a)
const money = (n) => (n === null || n === undefined ? 'unknown' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (d) => {
  if (!d) return 'an unknown date';
  const dt = DateTime.fromISO(String(d).slice(0, 10));
  return dt.isValid ? dt.toFormat('LLL d, yyyy') : String(d);
};
const SUFFIXES = ['llc', 'inc', 'co', 'company', 'corp', 'ltd'];
const cleanName = (s) => {
  const words = String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 1 && SUFFIXES.includes(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(' ');
};
const short = (t, n = 40) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

// Why it was flagged, one sentence per kind of reason.
const MATH_WHY = 'Invoices are only recorded when the lines, tax and total agree.';
const DATE_WHY = 'A wrong date can make a payment late or early.';
const MISSING_WHY = 'Required fields must be readable before an invoice is recorded.';
const ALLOCATION_WHY = 'Every line needs a store and a cost category for the store reports.';
const WHY = {
  sum_mismatch: MATH_WHY, line_math_mismatch: MATH_WHY, total_mismatch: MATH_WHY,
  due_before_invoice: DATE_WHY, future_date: DATE_WHY,
  missing_invoice_number: MISSING_WHY, missing_supplier: MISSING_WHY, missing_invoice_date: MISSING_WHY,
  missing_total: MISSING_WHY, missing_line_items: MISSING_WHY,
  currency_not_usd: 'The books are kept in USD.',
  duplicate_amount_differs: 'Paying both copies would pay this invoice twice.',
  branch_unknown: ALLOCATION_WHY, uncategorized_line: ALLOCATION_WHY,
  vendor_not_in_quickbooks: 'Bills are only created for vendors that already exist in QuickBooks, so no duplicate vendors are made.',
};

const MATH_CHECK = 'Open the PDF. If it shows the same numbers, the supplier\'s invoice is wrong: ask them for a corrected one. If it doesn\'t, the reading was wrong: fix the record in Airtable.';
function problemsFor(j) {
  const inv = j.invoice || {};
  const d = j.details || {};
  const out = [];
  for (const code of j.reasons || []) {
    const x = d[code] || {};
    let problem;
    let check;
    switch (code) {
      case 'sum_mismatch':
        problem = `The line items add up to ${money(x.lines_total)}, but the invoice states a subtotal of ${money(x.subtotal)} (${money(x.difference)} difference).`;
        check = MATH_CHECK; break;
      case 'line_math_mismatch': {
        const lines = (x.lines || []).slice(0, 3).map((l) => (l.printed === null
          ? `Line ${l.line_no} (${short(l.description)}): the amount could not be read.`
          : `Line ${l.line_no} (${short(l.description)}): ${l.quantity} × ${money(l.unit_price)} = ${money(l.expected)}, but the invoice shows ${money(l.printed)}.`));
        const more = (x.lines || []).length - lines.length;
        problem = lines.join(' ') + (more > 0 ? ` And ${more} more line(s).` : '');
        check = MATH_CHECK; break;
      }
      case 'total_mismatch':
        problem = `Subtotal ${money(x.subtotal)} + tax ${money(x.tax)} = ${money(x.expected)}, but the invoice total is ${money(x.printed)}.`;
        check = MATH_CHECK; break;
      case 'due_before_invoice':
        problem = `The due date (${day(x.due_date)}) is before the invoice date (${day(x.invoice_date)}).`;
        check = 'Probably a typo. Confirm the real due date with the supplier before scheduling payment.'; break;
      case 'missing_invoice_number':
        problem = 'No invoice number was found, so the system can\'t check whether it was already paid.';
        check = 'Open the PDF. If a number is there, add it in Airtable. If there\'s none, ask the supplier for one. PO and account numbers are not invoice numbers.'; break;
      case 'missing_supplier':
      case 'missing_invoice_date':
      case 'missing_total':
      case 'missing_line_items':
        problem = `The ${x.field || code.replace('missing_', '').replace(/_/g, ' ')} could not be read.`;
        check = 'Open the PDF and fill it in in Airtable.'; break;
      case 'future_date':
        problem = `The invoice date (${day(x.invoice_date)}) is in the future.`;
        check = 'Check the date on the PDF before scheduling payment.'; break;
      case 'currency_not_usd':
        problem = `This invoice is in ${x.currency}, not USD.`;
        check = 'Confirm the USD amount with the supplier before paying.'; break;
      case 'duplicate_amount_differs': {
        const e = x.earlier || {};
        problem = `${inv.supplier || 'This supplier'} ${inv.invoice_number || ''} was already recorded${e.recorded_at ? ' on ' + day(e.recorded_at) : ''} for ${money(x.earlier_total)}, but this copy says ${money(x.this_total)}.`;
        check = 'It may be a corrected invoice. Keep one and void the other.'; break;
      }
      case 'branch_unknown':
        problem = `${x.lines} line(s) totalling ${money(x.amount)} could not be assigned to a store: no delivery address and no store named on the line.`;
        check = 'Set the Branch on those lines in Airtable. If the supplier always leaves the address off, ask them to add it.'; break;
      case 'vendor_not_in_quickbooks': {
        const who = x.supplier || inv.supplier || 'The supplier';
        if ((x.matches || []).length > 1) {
          problem = `${who} matches more than one vendor in QuickBooks (${x.matches.join(', ')}), so no bill was created.`;
          check = 'Merge or rename those vendors in QuickBooks so only one matches, then create the bill from the Airtable record.';
        } else {
          problem = `${who} is not set up as a vendor in QuickBooks, so no bill was created.`;
          check = 'Add the vendor in QuickBooks (or fix the spelling), then create the bill from the Airtable record.';
        }
        break;
      }
      case 'uncategorized_line':
        problem = `${x.lines} line(s) totalling ${money(x.amount)} have no cost category` + ((x.examples || []).length ? ` (e.g. "${short(x.examples[0])}").` : '.');
        check = 'Pick the Category in Airtable. If it is a new kind of purchase, add it to the category list.'; break;
      default:
        problem = `Flagged: ${code}.`;
        check = 'Open the PDF and check the record in Airtable.';
    }
    out.push({ reason: code, problem, why: WHY[code] || 'A person needs to look at this before it is recorded.', check });
  }
  return out;
}

return $input.all().map((item) => {
  const j = item.json;
  const cfg = j.config;
  const inv = j.invoice;
  const branchName = Object.fromEntries(cfg.branches.map((b) => [b.code, b.name]));
  branchName.unassigned = 'Unassigned';
  const categoryName = Object.fromEntries(cfg.categories.map((c) => [c.code, c.name]));
  const problems = problemsFor(j);
  const problemText = problems.length === 1
    ? `Problem: ${problems[0].problem}\nWhy it was flagged: ${problems[0].why}\nWhat to check: ${problems[0].check}`
    : problems.map((p, n) => `${n + 1}. Problem: ${p.problem}\n   Why it was flagged: ${p.why}\n   What to check: ${p.check}`).join('\n');

  // The QuickBooks vendor name, when one matched, so the same supplier is always spelled the same way.
  const supplierName = (j.vendor && j.vendor.name) || inv.supplier;
  const supplierForFile = cleanName(supplierName) || 'Unknown supplier';
  const numberForFile = inv.invoice_number ? inv.invoice_number.replace(/[\\/:*?"<>|\s]+/g, '-') : 'no-number_' + (inv.invoice_date || String(j.received_at).slice(0, 10));
  const invoiceFields = {
    'Invoice number': inv.invoice_number || undefined,
    'Supplier': supplierName || undefined,
    'Invoice date': inv.invoice_date || undefined,
    'Due date': inv.due_date || undefined,
    'Currency': inv.currency || undefined,
    'Subtotal': inv.subtotal ?? undefined,
    'Tax': inv.tax ?? undefined,
    'Total': inv.total ?? undefined,
    'Ship-to branch': j.allocation && j.allocation.ship_to_branch ? branchName[j.allocation.ship_to_branch] : undefined,
    'Status': j.route === 'recorded' ? 'Recorded' : 'Needs Review',
    'Review reasons': j.reasons.length ? j.reasons : undefined,
    'Problem': problems.length ? problemText : undefined,
    'Source': `${j.sender_name ? j.sender_name + ' ' : ''}<${j.sender}> · ${j.subject ? '"' + j.subject + '"' : '(no subject)'}`,
    'Received at': j.received_at,
    'Dup key': j.dup_key || undefined,
  };
  const lineFields = (inv.line_items || []).map((l, n) => ({
    'Line no': l.line_no,
    'Description': l.description,
    'Quantity': l.quantity ?? undefined,
    'Unit price': l.unit_price ?? undefined,
    'Amount': l.amount ?? undefined,
    'Branch': branchName[j.allocation.lines[n].branch] || undefined,
    'Category': categoryName[l.category] || undefined,
  }));
  return {
    json: {
      ...j,
      problems,
      problem_text: problems.length ? problemText : '',
      record: {
        drive_file_name: `${supplierForFile}_${numberForFile}.pdf`,
        invoice_fields: JSON.parse(JSON.stringify(invoiceFields)), // drops the undefined fields
        line_fields: JSON.parse(JSON.stringify(lineFields)),
      },
    },
    binary: item.binary,
  };
});
