// Stage 6b: write each new bill's QuickBooks ID into its Airtable invoice (10 records per
// request) and check that QuickBooks shows the total the bill was built with.
const bills = $input.all().map((item, i) => {
  const req = $('Bill Requests').itemMatching(i).json;
  const bill = item.json.Bill || {};
  const total = bill.TotalAmt === undefined ? null : Number(bill.TotalAmt);
  return {
    airtable_record_id: req.airtable_record_id,
    invoice_number: req.invoice_number,
    bill_id: bill.Id ? String(bill.Id) : null,
    bill_total: total,
    expected_total: req.expected_total,
    printed_total: req.printed_total,
    total_ok: total !== null && Math.abs(total - req.expected_total) < 0.005,
  };
});

const saved = bills.filter((b) => b.bill_id);
const out = [];
for (let start = 0; start < saved.length; start += 10) {
  const chunk = saved.slice(start, start + 10);
  out.push({
    json: {
      bills: chunk,
      body: { records: chunk.map((b) => ({ id: b.airtable_record_id, fields: { 'QuickBooks bill': b.bill_id } })) },
    },
  });
}
return out;
