// Strips or generalizes identifying information before any context string is
// sent to a third-party AI provider (OpenAI/Anthropic/Ollama). Two passes:
// (1) known identifier fields are swapped for neutral labels at the call site
// (org name), (2) a generic regex sweep over the fully-assembled context as
// defense-in-depth for anything that slipped through a free-text field
// (emails, key-shaped tokens) — this is what makes buildChatContext's output
// safe to hand to any provider, not just well-behaved input.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Datadog API/App keys and similar long hex tokens — shouldn't ever reach this
// far (collectors redact these separately), but a free-text org-profile field
// is user-typed and unvalidated, so treat it as untrusted input too.
const HEX_TOKEN_RE = /\b[a-f0-9]{32,40}\b/gi;

/** Final catch-all pass — run on the fully assembled context string. */
export function redactPII(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL_RE, '[email redacted]')
    .replace(HEX_TOKEN_RE, '[token redacted]');
}

/**
 * Replace every literal occurrence of the org's real name with a neutral
 * label, so free-text fields (business description, additional context,
 * pain points, etc.) that repeat the company name don't leak it to the AI
 * provider even though the org's actual name/id is never passed in as a
 * discrete field to begin with.
 */
export function redactOrgName(text: string, orgName: string | null | undefined): string {
  if (!text || !orgName || orgName.trim().length < 3) return text;
  const escaped = orgName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'gi'), 'this organization');
}
