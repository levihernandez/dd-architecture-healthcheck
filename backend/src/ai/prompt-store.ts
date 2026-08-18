import fs from 'fs';
import path from 'path';

/** Host-editable prompt files powering every AI surface (chat, one-shot
 * assessment, and each provider's system-message addendum). Files live under
 * PROMPTS_DIR — a plain directory, not the DB — so a human can `git diff`/
 * `git commit` on the host and the "Prompts" tab in AI Settings edits the
 * exact same files. No custom versioning here; git is the history. */

export interface PromptDescriptor {
  key: string;
  label: string;
  filePath: string;
}

// Strict allowlist — getPrompt/savePrompt reject anything not listed here so
// a crafted `key` can never escape PROMPTS_DIR (path traversal).
const PROMPT_REGISTRY: Array<{ key: string; label: string; fileName: string }> = [
  { key: 'chat-system', label: 'Chat System Prompt', fileName: 'chat-system-prompt.md' },
  { key: 'assessment-instructions', label: 'Assessment Instructions', fileName: 'assessment-prompt-instructions.md' },
  { key: 'grounding', label: 'Grounding Instructions', fileName: 'grounding-instructions.md' },
  { key: 'openai-system', label: 'OpenAI System Addendum', fileName: 'openai-system.md' },
  { key: 'anthropic-system', label: 'Anthropic System Addendum', fileName: 'anthropic-system.md' },
  { key: 'ollama-system', label: 'Ollama System Addendum', fileName: 'ollama-system.md' },
  { key: 'tagging-impl-hard', label: 'Tagging Implementation Guide — Hard Tagging', fileName: 'tagging-impl-hard.md' },
  { key: 'tagging-impl-soft', label: 'Tagging Implementation Guide — Soft Tagging', fileName: 'tagging-impl-soft.md' },
];

function getPromptsDir(): string {
  return process.env.PROMPTS_DIR || path.join(process.cwd(), 'prompts');
}

function getDefaultsDir(): string {
  return path.join(__dirname, 'prompt-defaults');
}

function findEntry(key: string) {
  const entry = PROMPT_REGISTRY.find((p) => p.key === key);
  if (!entry) throw new Error(`Unknown prompt key: ${key}`);
  return entry;
}

function resolveFilePath(fileName: string): string {
  return path.join(getPromptsDir(), fileName);
}

/** Copies bundled defaults into PROMPTS_DIR for any file that's missing —
 * called on boot so a fresh checkout or a fresh (empty) mounted volume in
 * prod always has working prompts. Never overwrites an existing file, so
 * host edits are never clobbered by a redeploy. */
export function ensurePromptsSeeded(): void {
  const dir = getPromptsDir();
  fs.mkdirSync(dir, { recursive: true });

  for (const entry of PROMPT_REGISTRY) {
    const target = resolveFilePath(entry.fileName);
    if (fs.existsSync(target)) continue;
    const defaultPath = path.join(getDefaultsDir(), entry.fileName);
    fs.copyFileSync(defaultPath, target);
  }
}

/** Reads fresh from disk every call (no module-level caching) so edits made
 * through the UI take effect immediately, without a server restart. */
export function getPrompt(key: string): string {
  const entry = findEntry(key);
  const filePath = resolveFilePath(entry.fileName);
  if (!fs.existsSync(filePath)) {
    // Lazily self-heal if a file was deleted after boot-time seeding.
    ensurePromptsSeeded();
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export function savePrompt(key: string, content: string): void {
  const entry = findEntry(key);
  const dir = getPromptsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolveFilePath(entry.fileName), content, 'utf-8');
}

export function listPrompts(): (PromptDescriptor & { content: string })[] {
  return PROMPT_REGISTRY.map((entry) => ({
    key: entry.key,
    label: entry.label,
    filePath: resolveFilePath(entry.fileName),
    content: getPrompt(entry.key),
  }));
}

export function isKnownPromptKey(key: string): boolean {
  return PROMPT_REGISTRY.some((p) => p.key === key);
}
