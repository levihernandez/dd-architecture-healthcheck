import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { aiSettingsApi } from '../services/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
}

const QUICK_PROMPTS = [
  {
    icon: '📊',
    label: 'Custom Metrics',
    prompt: 'Assess my custom metric usage. Identify the top cardinality drivers, estimate my current volume vs standard allotment, and give me a prioritized action plan to control on-demand metric costs.',
  },
  {
    icon: '🪵',
    label: 'Log Indexing',
    prompt: 'Review my log indexing configuration. Identify indexes without exclusion filters, assess retention vs query frequency, flag rate-limited indexes, and recommend where to implement Flex Logs to reduce indexing spend.',
  },
  {
    icon: '🔍',
    label: 'APM Sampling',
    prompt: 'Evaluate my APM trace sampling strategy. Estimate current ingestion and indexing volumes, identify services that need guaranteed retention, and recommend retention filter tuning to optimize spend without losing critical visibility.',
  },
  {
    icon: '🧪',
    label: 'Synthetics',
    prompt: 'Review my Synthetics test configuration. Identify browser tests replaceable with API tests, flag over-frequent or over-located tests, and calculate the monthly run reduction from each optimization.',
  },
  {
    icon: '🏷',
    label: 'Tagging Plan',
    prompt: 'Analyze my Unified Service Tagging (UST) gaps across all four keys (env/service/version/team). Generate a step-by-step remediation plan with owner assignments, rollout sequence, and validation steps.',
  },
  {
    icon: '🖥',
    label: 'Host Allotment',
    prompt: 'Assess my infrastructure footprint. Break down host count by tier, estimate allotment consumption, identify untagged hosts that inflate costs without attribution, and flag any containers or cloud accounts generating unexpected metric volume.',
  },
  {
    icon: '⚡',
    label: 'Quick Wins',
    prompt: 'Identify my top 5 quick wins to reduce Datadog spend or improve observability quality in the next 30 days. Focus on low-effort, high-impact actions with specific implementation steps.',
  },
  {
    icon: '👤',
    label: 'RUM Coverage',
    prompt: 'Review my RUM and frontend observability configuration. Assess session sampling rates, replay coverage, identify gaps in user journey monitoring, and recommend session and replay sampling thresholds for cost-effective coverage.',
  },
  {
    icon: '📦',
    label: 'Product Utilization',
    prompt: 'Evaluate which Datadog products I\'m using effectively vs underutilizing. Identify products I may be paying for but not leveraging, and give me an activation roadmap to maximize value from my current investment.',
  },
  {
    icon: '💰',
    label: 'FinOps Plan',
    prompt: 'Generate a comprehensive FinOps action plan. Quantify my estimated spend profile by product area, identify the top 10 cost reduction levers, and create a phased 90-day optimization roadmap with expected savings for each initiative.',
  },
];

// Simple markdown renderer — handles code blocks, inline code, bold, lists, headings
function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="bg-gray-900 text-green-300 text-xs rounded-lg p-3 overflow-x-auto my-2 font-mono">
          {lang && <div className="text-gray-500 text-xs mb-1">{lang}</div>}
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const cls = level === 1 ? 'text-base font-bold text-gray-900 mt-3 mb-1'
        : level === 2 ? 'text-sm font-bold text-gray-800 mt-2 mb-1'
        : 'text-sm font-semibold text-gray-700 mt-2';
      elements.push(<p key={i} className={cls}>{text}</p>);
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      elements.push(<hr key={i} className="my-3 border-gray-200" />);
      i++;
      continue;
    }

    // Bullet list
    if (line.match(/^[\-\*]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[\-\*]\s/)) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={i} className="list-none space-y-1 my-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm text-gray-700">
              <span className="text-violet-400 mt-0.5 shrink-0">▸</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      let num = 1;
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      elements.push(
        <ol key={i} className="space-y-1 my-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm text-gray-700">
              <span className="text-violet-600 font-semibold shrink-0 w-4">{j + 1}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line → spacer
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-1.5" />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="text-sm text-gray-700 leading-relaxed">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  // Split on **bold**, `code`, and normal text
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-violet-50 text-violet-700 text-xs px-1 py-0.5 rounded font-mono border border-violet-100">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export default function AIChatAssistant() {
  const { orgs, scans, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const { data: aiSettings } = useQuery({ queryKey: ['ai-settings'], queryFn: aiSettingsApi.get });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Welcome message when org/scan selected
  useEffect(() => {
    if (selectedOrgId && selectedScanId && messages.length === 0) {
      const orgName = orgs.find(o => o.id === selectedOrgId)?.name ?? 'your org';
      setMessages([{
        role: 'assistant',
        content: `I've loaded the latest scan data for **${orgName}**. I have full visibility into your infrastructure inventory, tagging coverage, log indexes, APM services, Synthetics tests, custom metric profile, and all scan findings.\n\nAsk me anything about your Datadog setup, or pick a quick prompt on the left to run a focused assessment.`,
      }]);
    }
  }, [selectedOrgId, selectedScanId]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;
    if (!selectedOrgId) { alert('Select an org first'); return; }

    const userMessage: Message = { role: 'user', content: text.trim() };
    const nextMessages = [...messages, userMessage];
    setMessages([...nextMessages, { role: 'assistant', content: '', streaming: true }]);
    setInput('');
    setIsStreaming(true);

    abortRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: selectedOrgId,
          scanId: selectedScanId || undefined,
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const rawChunk = decoder.decode(value, { stream: true });
        const lines = rawChunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data) as { type: string; content: string };
            if (parsed.type === 'token') {
              assistantContent += parsed.content;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: assistantContent,
                  streaming: true,
                };
                return updated;
              });
            } else if (parsed.type === 'error') {
              assistantContent = `Error: ${parsed.content}`;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: assistantContent, error: true };
                return updated;
              });
            }
          } catch { /* malformed SSE line, skip */ }
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
        return updated;
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: updated[updated.length - 1].content + ' *(stopped)*' };
          return updated;
        });
      } else {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: `Connection error: ${(err as Error).message}`,
            error: true,
          };
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [messages, isStreaming, selectedOrgId, selectedScanId]);

  const stop = () => {
    abortRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden -mx-6 -my-6">
      {/* Quick prompts sidebar */}
      <div className="w-56 shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col overflow-hidden">
        <div className="px-3 pt-4 pb-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Quick Assessments</div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p.label}
              onClick={() => send(p.prompt)}
              disabled={isStreaming || !selectedOrgId}
              className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-gray-700 hover:bg-violet-50 hover:text-violet-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed group"
            >
              <span className="text-base mr-1.5">{p.icon}</span>
              <span className="font-medium">{p.label}</span>
            </button>
          ))}
        </div>
        <div className="px-3 py-3 border-t border-gray-200">
          <button
            onClick={() => { setMessages([]); }}
            className="w-full text-xs text-gray-400 hover:text-gray-600 py-1"
          >
            Clear conversation
          </button>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 bg-white shrink-0">
          <span className="text-sm font-semibold text-gray-900">AI Advisor</span>
          {aiSettings && (aiSettings.provider !== 'none' || aiSettings.envProvider) ? (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              {aiSettings.provider !== 'none' ? aiSettings.provider : aiSettings.envProvider}
              {aiSettings.model ? ` · ${aiSettings.model}` : ''}
            </span>
          ) : (
            <Link to="/ai-settings" className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium hover:bg-amber-200">
              ⚙ Configure AI provider
            </Link>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-gray-400">
              <div className="text-4xl">✨</div>
              <div className="text-sm font-medium text-gray-500">Select an org and scan, then ask anything about your Datadog setup.</div>
              <div className="text-xs">Or pick a quick assessment from the left panel.</div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
                  DD
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-violet-600 text-white rounded-br-sm'
                    : msg.error
                    ? 'bg-red-50 border border-red-200 rounded-bl-sm'
                    : 'bg-white border border-gray-200 shadow-sm rounded-bl-sm'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <>
                    {msg.content ? (
                      <MarkdownContent content={msg.content} />
                    ) : (
                      <div className="flex gap-1 py-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                    {msg.streaming && msg.content && (
                      <span className="inline-block w-0.5 h-3.5 bg-violet-500 ml-0.5 animate-pulse" />
                    )}
                  </>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-bold shrink-0 mt-0.5">
                  You
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedOrgId ? 'Ask about your Datadog setup… (Enter to send, Shift+Enter for newline)' : 'Select an org to start…'}
              disabled={!selectedOrgId}
              rows={1}
              className="flex-1 resize-none input text-sm py-2.5 max-h-36 overflow-y-auto disabled:opacity-50"
              style={{ lineHeight: '1.5' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
              }}
            />
            {isStreaming ? (
              <button
                onClick={stop}
                className="shrink-0 px-4 py-2.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || !selectedOrgId}
                className="shrink-0 px-4 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
            <span>Context: {selectedOrgId ? `${orgs.find(o => o.id === selectedOrgId)?.name ?? ''}` : 'no org'}</span>
            {selectedScanId && <span>· scan {new Date(scans.find(s => s.id === selectedScanId)?.startedAt ?? '').toLocaleDateString()}</span>}
            {aiSettings?.provider && aiSettings.provider !== 'none'
              ? <span className="ml-auto text-green-600">✓ {aiSettings.provider} · {aiSettings.model}</span>
              : <Link to="/ai-settings" className="ml-auto text-amber-600 hover:underline">Configure AI provider →</Link>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
