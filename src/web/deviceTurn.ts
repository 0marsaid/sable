import { randomUUID } from 'node:crypto';
import { deliverToUser } from '../agent/handle.js';
import { classifyApproval, formatApproval, pendingIsFresh } from '../agent/approval.js';
import { resolveApproval } from '../agent/loop.js';
import { WEB_USER } from '../phone.js';
import type { Runtime } from '../runtime.js';
import type { ToolContext } from '../tools/types.js';
import {
  HELP_TEXT,
  buildDevicePrompt,
  parseSlashCommand,
  parseToolCall,
  parseWhen,
  type ToolCallDraft,
} from './device.js';

export type DeviceContext = {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
};

function contextFor(runtime: Runtime): ToolContext {
  return {
    phone: WEB_USER,
    now: runtime.now(),
    timezone: runtime.config.timezone,
    store: runtime.store,
    fetchImpl: runtime.fetchImpl,
    searchProvider: runtime.config.searchProvider,
    tavilyApiKey: runtime.config.tavilyApiKey,
    braveApiKey: runtime.config.braveApiKey,
  };
}

function deviceContext(runtime: Runtime): DeviceContext {
  const facts = runtime.store.listFacts(WEB_USER);
  const history = runtime.store
    .recentMessages(WEB_USER, 16)
    .filter((message) => message.role === 'user' || (message.role === 'assistant' && message.content && !message.toolCalls?.length))
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content ?? '',
    }));
  return {
    system: buildDevicePrompt({
      assistantName: runtime.config.assistantName,
      ownerName: runtime.config.ownerName,
      timezone: runtime.config.timezone,
      now: runtime.now(),
      facts,
    }),
    messages: history,
  };
}

async function say(runtime: Runtime, text: string): Promise<void> {
  runtime.store.addMessage({ phone: WEB_USER, role: 'assistant', content: text, createdAt: runtime.now() });
  await deliverToUser(runtime, WEB_USER, text);
}

async function runTool(runtime: Runtime, draft: ToolCallDraft): Promise<void> {
  const tool = runtime.tools.find((item) => item.name === draft.name);
  const ctx = contextFor(runtime);
  if (!tool) {
    await say(runtime, `I don't have a tool named ${draft.name}. Try /help.`);
    return;
  }
  const invalid = tool.validate?.(draft.arguments, ctx) ?? null;
  if (invalid) {
    await say(runtime, invalid);
    return;
  }
  const call = { id: `device-${randomUUID()}`, name: tool.name, arguments: draft.arguments };
  if (tool.sensitive) {
    const summary = tool.summarize(draft.arguments, ctx);
    runtime.store.addMessage({
      phone: WEB_USER,
      role: 'assistant',
      content: null,
      toolCalls: [call],
      createdAt: runtime.now(),
    });
    runtime.store.setPending(WEB_USER, [call], [summary], runtime.now());
    await deliverToUser(runtime, WEB_USER, formatApproval([summary]));
    return;
  }
  let output: string;
  try {
    output = await tool.execute(draft.arguments, ctx);
  } catch (error) {
    output = error instanceof Error ? error.message : 'That tool failed.';
  }
  await say(runtime, output);
}

async function runSlash(runtime: Runtime, text: string): Promise<boolean> {
  const command = parseSlashCommand(text);
  if (!command) return false;
  runtime.store.addMessage({ phone: WEB_USER, role: 'user', content: text, createdAt: runtime.now() });
  if (command.kind === 'help') {
    await say(runtime, HELP_TEXT);
    return true;
  }
  if (command.kind === 'unknown') {
    await say(runtime, `I don't know that command.\n\n${HELP_TEXT}`);
    return true;
  }
  if (command.kind === 'note') {
    await runTool(runtime, { name: 'add_note', arguments: { text: command.text, todo: command.todo } });
    return true;
  }
  if (command.kind === 'notes') {
    await runTool(runtime, { name: 'list_notes', arguments: {} });
    return true;
  }
  if (command.kind === 'remember') {
    await runTool(runtime, { name: 'remember_fact', arguments: { fact: command.text } });
    return true;
  }
  if (command.kind === 'memory') {
    await runTool(runtime, { name: 'list_facts', arguments: {} });
    return true;
  }
  if (command.kind === 'reminders') {
    await runTool(runtime, { name: 'list_reminders', arguments: {} });
    return true;
  }
  if (command.kind === 'cancel') {
    await runTool(runtime, { name: 'cancel_reminder', arguments: { id: command.id } });
    return true;
  }
  if (command.kind === 'forget') {
    await runTool(runtime, { name: 'forget_fact', arguments: { id: command.id } });
    return true;
  }
  const when = parseWhen(command.when, runtime.now(), runtime.config.timezone);
  if (!when) {
    await say(runtime, 'I could not read that time. Try /remind in 2 hours | stretch, or /remind tomorrow 9am | call the dentist.');
    return true;
  }
  await runTool(runtime, {
    name: 'create_reminder',
    arguments: { message: command.message, remind_at: when.toISOString() },
  });
  return true;
}

export async function handleDeviceText(runtime: Runtime, text: string): Promise<{ needsModel: boolean; context?: DeviceContext }> {
  const pending = runtime.store.getPending(WEB_USER);
  const fresh = pending && pendingIsFresh(pending.createdAt, runtime.now());
  const decision = classifyApproval(text);
  if (fresh && decision !== 'other') {
    const reply = await resolveApproval({
      phone: WEB_USER,
      decision,
      config: runtime.config,
      store: runtime.store,
      llm: runtime.llm,
      tools: runtime.tools,
      now: runtime.now(),
      fetchImpl: runtime.fetchImpl,
      continueWithModel: false,
    });
    await deliverToUser(runtime, WEB_USER, reply);
    return { needsModel: false };
  }
  if (await runSlash(runtime, text)) return { needsModel: false };
  runtime.store.addMessage({ phone: WEB_USER, role: 'user', content: text, createdAt: runtime.now() });
  return { needsModel: true, context: deviceContext(runtime) };
}

export async function handleDeviceReply(runtime: Runtime, text: string): Promise<void> {
  const call = parseToolCall(text);
  if (!call) {
    await say(runtime, text.trim() || '…');
    return;
  }
  await runTool(runtime, call);
}
