// Turns Gemini's reply into the raw reading. No checks on the numbers yet: stage 4 does that.
// If Gemini still failed after 3 attempts, the item carries on marked ai_failed,
// so it is logged and reported instead of disappearing.
const ctx = $('Read Path').item.json;
const r = $json;
const usage = r.usageMetadata || {};
let reading = null;
let aiError = null;
let finishReason = null;

if (r.error) {
  const e = r.error;
  const msg = (e && (e.message || e.description)) || (typeof e === 'string' ? e : 'unknown error');
  aiError = ('Gemini request failed: ' + msg).slice(0, 500);
} else {
  const cand = (r.candidates || [])[0] || {};
  finishReason = cand.finishReason || null;
  const text = ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
  if (!text) {
    aiError = 'Gemini returned no text (' + (cand.finishReason || (r.promptFeedback && r.promptFeedback.blockReason) || 'no reason given') + ')';
  } else {
    try { reading = JSON.parse(text); }
    catch (e) { aiError = 'Gemini reply was not valid JSON (finishReason ' + (cand.finishReason || 'unknown') + ')'; }
  }
  if (reading !== null && (typeof reading !== 'object' || Array.isArray(reading))) {
    reading = null;
    aiError = 'Gemini reply was JSON but not an object';
  }
}

const { gemini_request, ...rest } = ctx;
return {
  json: {
    ...rest,
    reading,
    ai_failed: !reading,
    ai_error: aiError,
    finish_reason: finishReason,
    model_version: r.modelVersion || ctx.config.model,
    tokens_in: usage.promptTokenCount ?? null,
    tokens_out: usage.candidatesTokenCount ?? null,
    tokens_thinking: usage.thoughtsTokenCount ?? null,
    read_ms: Date.now() - ctx.read_started_at,
  },
  binary: $('Read Path').item.binary,
};
