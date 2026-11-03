export function normalizeExecutionMetadata(value) {
  if (value === undefined) return { selection: 'unknown', requestedModel: null, actualModel: null, confirmation: 'unknown',
    effort: null, reason: 'Host did not supply model execution metadata.', usage: null };
  if (!value || !['inline', 'delegated', 'pinned', 'unsupported', 'unknown'].includes(value.selection)
    || !['confirmed', 'unknown', 'unsupported'].includes(value.confirmation)
    || typeof value.reason !== 'string' || !value.reason.trim()) throw new Error('Invalid model execution metadata.');
  for (const field of ['requestedModel', 'actualModel', 'effort']) {
    if (value[field] !== null && (typeof value[field] !== 'string' || !value[field].trim())) throw new Error(`Execution metadata needs ${field} or null.`);
  }
  if (value.confirmation === 'confirmed' && (!value.actualModel || typeof value.metadataRef !== 'string' || !value.metadataRef.trim())) {
    throw new Error('Confirmed model requires actualModel and host metadataRef.');
  }
  if (value.confirmation !== 'confirmed' && value.actualModel !== null) throw new Error('Unconfirmed actual model must stay null.');
  if (value.usage !== null) {
    if (!value.usage || typeof value.usage.source !== 'string' || !value.usage.source.trim()) throw new Error('Usage requires its host source.');
    for (const field of ['inputTokens', 'outputTokens', 'cost']) {
      const amount = value.usage[field];
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error('Unknown usage must be null; observed usage must be nonnegative.');
    }
  }
  return structuredClone(value);
}
