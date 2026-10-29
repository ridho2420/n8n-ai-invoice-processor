// Stage 6b: find the QuickBooks vendor for each invoice that will be recorded.
// Names are compared the same way as for the duplicate key: lower case, no punctuation,
// company suffixes (LLC, Inc, Co, ...) dropped, against the vendor's display name and
// company name (accents removed: \p{M} = combining marks after NFD).
// Exactly one vendor must match. Vendors are never created here: with no
// match (or more than one), no bill is made and the invoice goes to review.
const SUFFIXES = ['llc', 'inc', 'co', 'company', 'corp', 'ltd'];
const normSupplier = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  .filter((w) => w && !SUFFIXES.includes(w)).join(' ');

const reply = $('Find QuickBooks Vendors').first().json;
const vendors = ((reply.QueryResponse && reply.QueryResponse.Vendor) || []).map((v) => ({
  id: String(v.Id),
  name: v.DisplayName,
  keys: [...new Set([v.DisplayName, v.CompanyName].filter(Boolean).map(normSupplier))],
}));

return $('To Record?').all(0).map((item) => {
  const j = item.json;
  const key = normSupplier(j.invoice && j.invoice.supplier);
  const matches = key ? vendors.filter((v) => v.keys.includes(key)) : [];
  const vendor = matches.length === 1
    ? { id: matches[0].id, name: matches[0].name, match: 'one' }
    : { id: null, name: null, match: matches.length ? 'several' : 'none', candidates: matches.map((m) => m.name) };

  if (vendor.match === 'one') {
    return { json: { ...j, vendor, vendors_checked: vendors.length }, binary: item.binary };
  }
  return {
    json: {
      ...j,
      vendor,
      vendors_checked: vendors.length,
      route: 'needs_review',
      reasons: [...j.reasons, 'vendor_not_in_quickbooks'],
      details: { ...j.details, vendor_not_in_quickbooks: { supplier: j.invoice && j.invoice.supplier, matches: matches.map((m) => m.name) } },
    },
    binary: item.binary,
  };
});
