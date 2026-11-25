import type { AppConfig } from '../config.js';
import type { ChatMessage, LlmClient, ToolCall } from '../llm/types.js';
import type { Store } from '../store.js';
import type { DownloadedMedia } from '../whatsapp/types.js';
import type { Tool, ToolContext } from '../tools/types.js';
import { formatApproval } from './approval.js';
import { buildSystemPrompt } from './prompt.js';

const MAX_STEPS = 4;

export type AgentResult = {
  text: string;
  approval: boolean;
};

function historyMessages(store: Store, phone: string, limit: number): ChatMessage[] {
  const rows = store.recentMessages(phone, limit);
  const start = rows.findIndex((row) => row.role === 'user');
  const sliced = start === -1 ? [] : rows.slice(start);
  const messages: ChatMessage[] = [];
  for (const row of sliced) {
    if (row.role === 'user') {
      messages.push({ role: 'user', content: row.content ?? '' });
    } else if (row.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: row.content,
        toolCalls: row.toolCalls ?? undefined,
      });
    } else if (row.role === 'tool' && row.toolCallId) {
      messages.push({
        role: 'tool',
        toolCallId: row.toolCallId,
        name: row.name ?? 'tool',
        content: row.content ?? '',
      });
    }
  }
  return messages;
}

function attachImage(messages: ChatMessage[], image: DownloadedMedia | null): ChatMessage[] {
  if (!image) return messages;
  const copy = messages.map((message) => ({ ...message })) as ChatMessage[];
  for (let index = copy.length - 1; index >= 0; index -= 1) {
    const message = copy[index];
    if (message.role !== 'user' || typeof message.content !== 'string') continue;
    copy[index] = {
      role: 'user',
      content: [
        { type: 'text', text: message.content },
        { type: 'image_url', imageUrl: `data:${image.mimeType};base64,${image.base64}` },
      ],
    };
    break;
  }
  return copy;
}

function toolContext(config: AppConfig, store: Store, phone: string, now: Date, fetchImpl: typeof fetch): ToolContext {
  return {
    phone,
    now,
    timezone: config.timezone,
    store,
    fetchImpl,
    searchProvider: config.searchProvider,
    tavilyApiKey: config.tavilyApiKey,
    braveApiKey: config.braveApiKey,
  };
}

async function runTool(tool: Tool, call: ToolCall, ctx: ToolContext): Promise<string> {
  try {
    const invalid = tool.validate?.(call.arguments, ctx) ?? null;
    if (invalid) return invalid;
    return await tool.execute(call.arguments, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'the tool failed';
    return `Tool ${tool.name} failed: ${message}`;
  }
}

export async function runAgent(input: {
  phone: string;
  config: AppConfig;
  store: Store;
  llm: LlmClient;
  tools: Tool[];
  now: Date;
  fetchImpl: typeof fetch;
  image?: DownloadedMedia | null;
}): Promise<AgentResult> {
  const { phone, config, store, llm, tools, now, fetchImpl } = input;
  const ctx = toolContext(config, store, phone, now, fetchImpl);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const schemas = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));

  for (let step = 0; step < MAX_STEPS; step += 1) {
    store.repairDanglingToolCalls(phone);
    const facts = store.listFacts(phone);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt({
          assistantName: config.assistantName,
          ownerName: config.ownerName,
          timezone: config.timezone,
          now,
          facts,
        }),
      },
      ...attachImage(historyMessages(store, phone, config.historyLimit), input.image ?? null),
    ];

    const result = await llm.chat({ messages, tools: schemas });
    if (result.toolCalls.length === 0) {
      const text = result.content?.trim() || "I'm here. What do you need?";
      store.addMessage({ phone, role: 'assistant', content: text, createdAt: now });
      return { text, approval: false };
    }

    store.addMessage({
      phone,
      role: 'assistant',
      content: result.content,
      toolCalls: result.toolCalls,
      createdAt: now,
    });

    for (let index = 0; index < result.toolCalls.length; index += 1) {
      const call = result.toolCalls[index];
      const tool = byName.get(call.name);
      if (!tool) {
        store.addMessage({
          phone,
          role: 'tool',
          content: `Unknown tool: ${call.name}`,
          toolCallId: call.id,
          name: call.name,
          createdAt: now,
        });
        continue;
      }

      const invalid = tool.validate?.(call.arguments, ctx) ?? null;
      if (invalid) {
        store.addMessage({
          phone,
          role: 'tool',
          content: invalid,
          toolCallId: call.id,
          name: call.name,
          createdAt: now,
        });
        continue;
      }

      if (tool.sensitive) {
        const remaining = result.toolCalls.slice(index);
        const summaries = remaining.map((item) => {
          const itemTool = byName.get(item.name);
          return itemTool ? itemTool.summarize(item.arguments, ctx) : item.name;
        });
        store.setPending(phone, remaining, summaries, now);
        return { text: formatApproval(summaries), approval: true };
      }

      const output = await runTool(tool, call, ctx);
      store.addMessage({
        phone,
        role: 'tool',
        content: output,
        toolCallId: call.id,
        name: call.name,
        createdAt: now,
      });
    }
  }

  const text = "I couldn't finish that in one go. Try asking in a smaller step.";
  store.addMessage({ phone, role: 'assistant', content: text, createdAt: now });
  return { text, approval: false };
}

export async function resolveApproval(input: {
  phone: string;
  decision: 'yes' | 'no';
  config: AppConfig;
  store: Store;
  llm: LlmClient;
  tools: Tool[];
  now: Date;
  fetchImpl: typeof fetch;
  /** Device mode already has a model in the browser, so skip the hosted follow-up. */
  continueWithModel?: boolean;
}): Promise<string> {
  const pending = input.store.getPending(input.phone);
  if (!pending) return 'Nothing is waiting for approval.';
  const byName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const ctx = toolContext(input.config, input.store, input.phone, input.now, input.fetchImpl);

  if (input.decision === 'no') {
    for (const call of pending.calls) {
      input.store.addMessage({
        phone: input.phone,
        role: 'tool',
        content: 'Not done — the user declined.',
        toolCallId: call.id,
        name: call.name,
        createdAt: input.now,
      });
    }
    input.store.clearPending(input.phone);
    const text = "Okay, I won't do that.";
    input.store.addMessage({ phone: input.phone, role: 'assistant', content: text, createdAt: input.now });
    return text;
  }

  const outputs: string[] = [];
  for (const call of pending.calls) {
    const tool = byName.get(call.name);
    const output = tool ? await runTool(tool, call, ctx) : `Unknown tool: ${call.name}`;
    outputs.push(output);
    input.store.addMessage({
      phone: input.phone,
      role: 'tool',
      content: output,
      toolCallId: call.id,
      name: call.name,
      createdAt: input.now,
    });
  }
  input.store.clearPending(input.phone);
  if (input.continueWithModel === false) {
    const text = outputs.join('\n\n') || 'Done.';
    input.store.addMessage({ phone: input.phone, role: 'assistant', content: text, createdAt: input.now });
    return text;
  }
  const followUp = await runAgent(input);
  return followUp.text;
}

export function cancelPending(store: Store, phone: string, now: Date, reason: string): boolean {
  const pending = store.getPending(phone);
  if (!pending) return false;
  for (const call of pending.calls) {
    store.addMessage({
      phone,
      role: 'tool',
      content: reason,
      toolCallId: call.id,
      name: call.name,
      createdAt: now,
    });
  }
  store.clearPending(phone);
  return true;
}
