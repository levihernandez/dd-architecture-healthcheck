import { getPrompt } from './prompt-store';

/** Shared anti-hallucination instructions injected into every AI surface that
 * generates prose/JSON from scan data — chat streaming and the one-shot
 * assessment providers alike. Backed by the host-editable `grounding`
 * prompt file (see prompt-store.ts) so the two surfaces don't drift in how
 * strictly they're told to stick to the evidence, and an edit made via the
 * AI Settings "Prompts" tab applies everywhere without a restart. */
export function getGroundingInstructions(): string {
  return getPrompt('grounding');
}
