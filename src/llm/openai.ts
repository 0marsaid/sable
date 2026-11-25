import type { AppConfig } from '../config.js';
import { asObject, isRecord } from '../json.js';
import type { ChatMessage, ChatRequest, ChatResult, ContentPart, LlmClient, ToolCall } from './types.js';

type FetchLike = typeof fetch;

function toOpenAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === 'assistant') {
    const payload: Record<string, unknown> = { role: 'assistant', content: message.content };
    if (message.toolCalls?.length) {
      payload.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }));
    }
    return payload;
  }
  if (message.role === 'user' && Array.isArray(message.content)) {
    return {
      role: 'user',
      content: message.content.map(partToOpenAi),
    };
  }
  return { role: message.role, content: message.content };
}

function partToOpenAi(part: ContentPart): Record<string, unknown> {
  if (part.type === 'text') return { type: 'text', text: part.text };
  return { type: 'image_url', image_url: { url: part.imageUrl } };
}

function hasImage(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'user' &&
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image_url'),
  );
}

function parseToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.function)) continue;
    const name = typeof item.function.name === 'string' ? item.function.name : '';
    const id = typeof item.id === 'string' ? item.id : '';
    if (!name || !id) continue;
    calls.push({
      id,
      name,
      arguments: asObject(item.function.arguments),
    });
  }
  return calls;
}

export class OpenAiLlm implements LlmClient {
  readonly configured: boolean;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.configured = Boolean(config.llmApiKey);
  }

  async chat(input: ChatRequest): Promise<ChatResult> {
    if (!this.config.llmApiKey) {
      throw new Error('LLM_API_KEY is not set');
    }
    const model =
      input.model ||
      (hasImage(input.messages) && this.config.llmVisionModel
        ? this.config.llmVisionModel
        : this.config.llmModel);

    const response = await this.fetchImpl(`${this.config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.llmApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: input.messages.map(toOpenAiMessage),
        tools: input.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: 'auto',
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const raw = await response.text();
    if (!response.ok) {
      const detail = raw.replaceAll(this.config.llmApiKey, '[redacted]').replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`LLM request failed (${response.status}): ${detail}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('LLM response was not JSON');
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.choices) || !isRecord(parsed.choices[0])) {
      throw new Error('LLM response did not include a choice');
    }
    const message = parsed.choices[0].message;
    if (!isRecord(message)) throw new Error('LLM response did not include a message');
    const content = typeof message.content === 'string' ? message.content : null;
    return { content, toolCalls: parseToolCalls(message.tool_calls) };
  }
}
