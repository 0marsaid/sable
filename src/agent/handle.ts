import { errorMessage } from '../logger.js';
import { isAllowed, normalizePhone, WEB_USER } from '../phone.js';
import type { Runtime } from '../runtime.js';
import { splitWhatsAppText } from '../split.js';
import { downloadInboundMedia } from '../whatsapp/media.js';
import type { InboundMessage } from '../whatsapp/types.js';
import { classifyApproval, pendingIsFresh } from './approval.js';
import { cancelPending, resolveApproval, runAgent } from './loop.js';

const NOT_CONFIGURED =
  "I'm up, but no language model is configured yet. Set LLM_API_KEY (and LLM_BASE_URL / LLM_MODEL if you aren't using OpenAI) and restart me.";

export async function deliverToUser(runtime: Runtime, to: string, text: string, reminder = false): Promise<void> {
  const parts = splitWhatsAppText(text);
  for (const part of parts) {
    runtime.store.logDelivery(to, part, runtime.now());
    await runtime.channel.sendText(to, part, reminder ? { reminder: true } : undefined);
  }
}

export async function handleInbound(message: InboundMessage, runtime: Runtime): Promise<void> {
  if (!message.id || !runtime.store.tryProcess(message.id, runtime.now())) return;
  if (message.kind === 'ignore') return;

  const phone = message.source === 'web' ? WEB_USER : normalizePhone(message.from);
  if (message.source !== 'web' && !isAllowed(phone, runtime.config.ownerPhones)) {
    runtime.log.info({ phone: `***${phone.slice(-4)}` }, 'ignored message from a number that is not allowlisted');
    return;
  }

  try {
    await handleOwner(message, phone, runtime);
  } catch (error) {
    runtime.log.error({ err: errorMessage(error) }, 'failed to handle message');
    try {
      await deliverToUser(runtime, phone, 'Something went wrong on my side. Please try again.');
    } catch (sendError) {
      runtime.log.error({ err: errorMessage(sendError) }, 'failed to send the error reply');
    }
  }
}

async function handleOwner(message: InboundMessage, phone: string, runtime: Runtime): Promise<void> {
  const now = runtime.now();
  const text = (message.text ?? '').trim();
  const decision = message.kind === 'text' ? classifyApproval(text) : 'other';
  let notice: 'expired' | 'dropped' | null = null;

  const pending = runtime.store.getPending(phone);
  if (pending && !pendingIsFresh(pending.createdAt, now)) {
    cancelPending(runtime.store, phone, now, 'Not done — the confirmation expired.');
    notice = 'expired';
  }

  const livePending = runtime.store.getPending(phone);
  if (livePending && decision !== 'other') {
    const reply = await resolveApproval({
      phone,
      decision,
      config: runtime.config,
      store: runtime.store,
      llm: runtime.llm,
      tools: runtime.tools,
      now,
      fetchImpl: runtime.fetchImpl,
    });
    await deliverToUser(runtime, phone, reply);
    return;
  }
  if (livePending) {
    cancelPending(
      runtime.store,
      phone,
      now,
      'Not done — the user sent a new message instead of confirming.',
    );
    notice = 'dropped';
  }

  if (notice === 'expired' && decision !== 'other') {
    await deliverToUser(runtime, phone, 'That confirmation expired. Ask me again if you still want it done.');
    return;
  }

  if (message.kind === 'unsupported') {
    const label = message.unsupportedLabel || 'that attachment';
    const extra =
      notice === 'dropped'
        ? '\n\nI also dropped the action that was waiting for your OK.'
        : notice === 'expired'
          ? '\n\nThe earlier confirmation had already expired.'
          : '';
    await deliverToUser(runtime, phone, `I can read text and photos, but I can't open ${label} yet.${extra}`);
    return;
  }

  if (!runtime.llm.configured) {
    runtime.store.addMessage({ phone, role: 'user', content: text || '[message]', createdAt: now });
    await deliverToUser(runtime, phone, NOT_CONFIGURED);
    return;
  }

  let image = null;
  let userText = text;

  if (message.kind === 'image') {
    image = message.inlineImage ?? (await downloadInboundMedia(message, runtime.config, runtime.fetchImpl));
    if (!image) {
      await deliverToUser(
        runtime,
        phone,
        "I got a photo, but I couldn't download it. Try sending it again, or tell me in text.",
      );
      return;
    }
    userText = text ? `[Photo] ${text}` : '[Photo] Please look at this image.';
  } else if (!userText) {
    await deliverToUser(runtime, phone, "I didn't catch any text. Send me a message or a photo.");
    return;
  }

  runtime.store.addMessage({ phone, role: 'user', content: userText.slice(0, 4096), createdAt: now });
  const result = await runAgent({
    phone,
    config: runtime.config,
    store: runtime.store,
    llm: runtime.llm,
    tools: runtime.tools,
    now,
    fetchImpl: runtime.fetchImpl,
    image,
  });
  const prefix =
    notice === 'dropped'
      ? 'I dropped the action that was waiting for your OK.\n\n'
      : notice === 'expired'
        ? 'That earlier confirmation expired.\n\n'
        : '';
  await deliverToUser(runtime, phone, prefix + result.text);
}

export async function deliverReminder(runtime: Runtime, phone: string, text: string): Promise<void> {
  await deliverToUser(runtime, phone, text, true);
}
