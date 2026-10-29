// Stage 5: one final route per document: error, not_invoice, duplicate, needs_review or recorded.
// Earlier invoices to compare with:
// - real email: records found in Airtable by "Find Earlier Invoices" (any status)
// - test file: the earlier documents of the same eval run, sent by the Eval Runner
// Same supplier + same number + same total = duplicate (nothing is recorded again).
// Same supplier + same number but a different total = needs_review (maybe a corrected invoice).
const items = $('Check & Allocate').all();
const isTest = items[0].json.source !== 'gmail';
const tolOf = (j) => (j.config && j.config.money_tolerance) || 0.01;
const toNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

let known = [];
if (isTest) {
  const prior = items[0].json.prior_dup_keys;
  known = (Array.isArray(prior) ? prior : [])
    .filter((p) => p && p.dup_key)
    .map((p) => ({ dup_key: String(p.dup_key), total: toNum(p.total), ref: p.case_id ? String(p.case_id) : 'earlier test file', recorded_at: null, where: 'this eval run' }));
} else {
  known = $input.all().map((i) => i.json).filter((r) => r && typeof r.id === 'string' && r.id.startsWith('rec'))
    .map((r) => {
      const f = r.fields || r;
      return { dup_key: String(f['Dup key'] || ''), total: toNum(f['Total']), ref: r.id, label: f['Invoice'] || null,
        recorded_at: f['Received at'] || null, status: f['Status'] || null, where: 'airtable' };
    })
    .filter((k) => k.dup_key);
}

const earlierFound = known.length;
const out = [];
items.forEach((item) => {
  const j = item.json;
  const reasons = [...(j.reasons || [])];
  const details = { ...(j.details || {}) };
  let route;
  let duplicateOf = null;

  if (j.check_status === 'error') route = 'error';
  else if (j.check_status === 'not_invoice') route = 'not_invoice';
  else {
    const match = j.dup_key ? known.find((k) => k.dup_key === j.dup_key) : null;
    const total = j.invoice ? j.invoice.total : null;
    if (match && total !== null && match.total !== null && Math.abs(total - match.total) <= tolOf(j) + 1e-9) {
      route = 'duplicate';
      duplicateOf = match;
    } else {
      if (match) {
        reasons.push('duplicate_amount_differs');
        details.duplicate_amount_differs = { earlier: match, earlier_total: match.total, this_total: total };
      }
      route = reasons.length ? 'needs_review' : 'recorded';
    }
    // Two copies in the same email or batch: the second one is compared with the first.
    if ((route === 'recorded' || route === 'needs_review') && j.dup_key) {
      known.push({ dup_key: j.dup_key, total, ref: j.case_id || j.file_name, recorded_at: null, where: 'this execution' });
    }
  }

  out.push({
    json: { ...j, route, reasons, details, duplicate_of: duplicateOf, earlier_found: earlierFound },
    binary: item.binary,
  });
});
return out;
