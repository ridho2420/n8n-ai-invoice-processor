// Test files stop here: no Drive, Airtable, QuickBooks or Slack.
// This item goes back to the Eval Runner, which checks it against the answer key.
// dup_key and total let the runner pass this document on as an "earlier invoice"
// to the next cases of the same run (only if it would have been recorded).
return $input.all().map((item) => {
  const j = item.json;
  return {
    json: {
      case_id: j.case_id,
      run_id: j.run_id,
      source: j.source,
      file_name: j.file_name,
      route: j.route,
      reasons: j.reasons,
      duplicate_of: j.duplicate_of ? j.duplicate_of.ref : null,
      dup_key: j.dup_key,
      total: j.invoice ? j.invoice.total : null,
      is_invoice: j.reading ? j.reading.is_invoice === true : null,
      reading: j.reading,
      allocation: j.allocation,
      read_path: j.read_path,
      text_chars: j.text_chars,
      pages: j.pages,
      ai_failed: j.ai_failed === true,
      ai_error: j.ai_error || null,
      model: j.config.model,
      prompt_version: j.config.prompt_version,
      model_version: j.model_version,
      tokens_in: j.tokens_in,
      tokens_out: j.tokens_out,
      read_ms: j.read_ms,
      execution_id: String($execution.id),
    },
  };
});
