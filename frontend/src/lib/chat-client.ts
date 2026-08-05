// Shared SSE client for POST /api/chat/stream — previously duplicated independently
// in AIChatAssistant.tsx, FloatingChat.tsx, and AISectionInsight.tsx.

export interface StreamChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamChatParams {
  orgId: string;
  scanId?: string;
  // Route path (e.g. "/logs") or a literal FindingCategory (e.g. "logs_health") —
  // scopes the backend's context to that domain and triggers maturity framing.
  page?: string;
  messages: StreamChatMessage[];
  signal?: AbortSignal;
}

export async function streamChat(
  params: StreamChatParams,
  onToken: (delta: string) => void,
  onError: (message: string) => void
): Promise<void> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgId: params.orgId,
      scanId: params.scanId || undefined,
      page: params.page || undefined,
      messages: params.messages,
    }),
    signal: params.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const rawChunk = decoder.decode(value, { stream: true });
    for (const line of rawChunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      try {
        const parsed = JSON.parse(data) as { type: string; content: string };
        if (parsed.type === 'token') onToken(parsed.content);
        else if (parsed.type === 'error') onError(parsed.content);
      } catch { /* malformed SSE line, skip */ }
    }
  }
}
