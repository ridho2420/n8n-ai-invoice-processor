// The request for this case, sent to "Copper Kettle – Invoice Processor" (eval mode).
// prior_dup_keys = documents earlier in this run that would have been recorded
// (recorded or needs_review), so a re-sent invoice (T11) can be caught as a duplicate,
// exactly like Airtable does for real emails.
const tc = $('Pace Gemini').first().json;
const prior = [];
for (let i = 0; i < $runIndex; i++) {
  let earlier = [];
  try { earlier = $('Run Invoice Processor').all(0, i); } catch (e) { earlier = []; }
  for (const it of earlier) {
    const r = it.json || {};
    if ((r.route === 'recorded' || r.route === 'needs_review') && r.dup_key) {
      prior.push({ dup_key: r.dup_key, total: r.total, case_id: r.case_id });
    }
  }
}
return [{
  json: {
    run_id: tc.run_id,
    case_id: String(tc.case_id),
    file_id: tc.file_id || '',
    file_name: tc.file_name,
    prior_dup_keys: prior,
  },
}];
