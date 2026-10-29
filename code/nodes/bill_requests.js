// Stage 6b: one QuickBooks bill per invoice with route "recorded" (the checks passed and
// exactly one vendor matched). Runs after the Airtable records exist, so the bill can name
// its Airtable record and the PDF. Needs-review invoices get no bill.
// One bill line per invoice line (account from the category, Class from the store),
// plus one line for the tax. The checks already made sure lines + tax = the printed total
// (within a cent per check), so the bill total matches the invoice.
const round = (n) => Math.round(Number(n) * 100) / 100;
const prepared = $('Prepare Record').all().map((p) => p.json);
const out = [];

for (const created of $('Create Invoice Record').all()) {
  const record = (created.json.records || [])[0];
  if (!record) continue;
  const dupKey = record.fields['Dup key'];
  const rec = prepared.find((p) => p.dup_key && p.dup_key === dupKey);
  if (!rec || rec.route !== 'recorded' || !rec.vendor || rec.vendor.match !== 'one') continue;

  const qb = rec.config.quickbooks;
  const inv = rec.invoice;
  const lines = inv.line_items.map((l, n) => {
    const branch = rec.allocation.lines[n].branch;
    const account = qb.accounts[l.category];
    const cls = qb.classes[branch];
    if (!account || !cls) throw new Error(`No QuickBooks account or Class for ${inv.invoice_number} line ${l.line_no} (category ${l.category}, store ${branch}). Check Config.`);
    return {
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: round(l.amount),
      Description: l.description,
      AccountBasedExpenseLineDetail: { AccountRef: { value: account }, ClassRef: { value: cls } },
    };
  });
  if (inv.tax) {
    lines.push({
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: round(inv.tax),
      Description: 'Sales tax',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: qb.tax_account },
        ClassRef: { value: qb.classes[(rec.allocation && rec.allocation.ship_to_branch) || 'shared'] },
      },
    });
  }

  const number = String(inv.invoice_number);
  const tooLong = number.length > qb.doc_number_max;
  const note = [
    `Invoice ${number} from ${rec.vendor.name}, recorded by the Copper Kettle AP automation.`,
    `Airtable record ${record.id}.`,
    record.fields.PDF ? `PDF: ${record.fields.PDF}` : null,
    `n8n execution ${$execution.id}.`,
    tooLong ? `The invoice number is longer than ${qb.doc_number_max} characters, so the bill number is shortened.` : null,
  ].filter(Boolean).join('\n');

  const body = {
    VendorRef: { value: rec.vendor.id },
    DocNumber: tooLong ? number.slice(0, qb.doc_number_max) : number,
    TxnDate: inv.invoice_date,
    PrivateNote: note,
    Line: lines,
  };
  if (inv.due_date) body.DueDate = inv.due_date;

  out.push({
    json: {
      airtable_record_id: record.id,
      dup_key: dupKey,
      invoice_number: number,
      expected_total: round(lines.reduce((sum, l) => sum + l.Amount, 0)), // what QuickBooks should show
      printed_total: round(inv.total),
      bill_url: `${qb.base_url}/bill?minorversion=${qb.minor_version}`,
      body,
    },
  });
}
return out;
