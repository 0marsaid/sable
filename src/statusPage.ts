import { metaReady, searchReady, twilioReady, type AppConfig } from './config.js';
import { formatPhone } from './phone.js';
import type { Runtime } from './runtime.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Row = { label: string; value: string; tone: 'ok' | 'warn' | 'muted' };

function rowsFor(config: AppConfig, llmConfigured: boolean): Row[] {
  const whatsapp =
    config.whatsappProvider === 'meta'
      ? metaReady(config)
        ? { value: 'Meta Cloud API, ready to send', tone: 'ok' as const }
        : { value: 'Meta selected. Add the access token, phone number id, and verify token.', tone: 'warn' as const }
      : config.whatsappProvider === 'twilio'
        ? twilioReady(config)
          ? { value: 'Twilio sandbox, ready to send', tone: 'ok' as const }
          : { value: 'Twilio selected. Add the account SID and auth token.', tone: 'warn' as const }
        : { value: 'Console dry run. Replies stay on this page and are not sent to WhatsApp.', tone: 'warn' as const };

  const llm = !llmConfigured
    ? { value: 'Not configured. Set LLM_API_KEY.', tone: 'warn' as const }
    : config.llmMode === 'mock'
      ? { value: 'Mock model. It echoes messages and does not use tools.', tone: 'warn' as const }
      : { value: `Ready, model ${config.llmModel}`, tone: 'ok' as const };

  const search = searchReady(config)
    ? { value: `${config.searchProvider} is ready`, tone: 'ok' as const }
    : { value: 'Off. Notes and reminders still work.', tone: 'muted' as const };

  const owners =
    config.ownerPhones.length === 0
      ? { value: 'Nobody. Set OWNER_PHONE_NUMBERS or every text is ignored.', tone: 'warn' as const }
      : {
          value: config.ownerPhones.map((phone) => formatPhone(phone)).join(', '),
          tone: 'ok' as const,
        };

  return [
    { label: 'WhatsApp', ...whatsapp },
    { label: 'Language model', ...llm },
    { label: 'Web search', ...search },
    { label: 'Allowlist', ...owners },
    {
      label: 'Webhook',
      value: config.publicBaseUrl ? `${config.publicBaseUrl}/webhook` : 'Set PUBLIC_BASE_URL once you have a public https address.',
      tone: config.publicBaseUrl ? 'ok' : 'muted',
    },
  ];
}

export function renderStatusPage(runtime: Runtime, options: { ignored?: boolean } = {}): string {
  const { config } = runtime;
  const rows = rowsFor(config, runtime.llm.configured);
  const consoleMode = config.whatsappProvider === 'console';
  const phoneOptions = config.ownerPhones
    .map((phone) => `<option value="${escapeHtml(formatPhone(phone))}">${escapeHtml(formatPhone(phone))}</option>`)
    .join('');
  const selected = config.ownerPhones[0] ?? '';
  const pending = selected ? runtime.store.getPending(selected) : undefined;
  const transcript = selected ? runtime.store.transcript(selected) : [];

  const bubbles = transcript.length
    ? transcript
        .map((item) => {
          const who = item.role === 'user' ? config.ownerName : config.assistantName;
          return `<article class="bubble ${item.role}"><span class="who">${escapeHtml(who)}</span><p>${escapeHtml(item.body)}</p></article>`;
        })
        .join('')
    : '<p class="empty">No messages yet. Send one below, the way you would text.</p>';

  const pendingBanner = pending
    ? `<aside class="banner">Waiting for YES or NO:\n${escapeHtml(pending.summaries.map((line) => `• ${line}`).join('\n'))}</aside>`
    : '';

  const ignoredBanner = options.ignored
    ? '<aside class="banner warn">That number is not on the allowlist, so nothing was sent back.</aside>'
    : '';

  const consoleBlock = consoleMode
    ? `<section class="card chat">
        <h2>Try it here</h2>
        <p class="lede">This box uses the same path as a WhatsApp message. It is only available in console mode. Do not put console mode on the public internet.</p>
        ${ignoredBanner}
        ${pendingBanner}
        <div class="thread">${bubbles}</div>
        <form method="post" action="/debug/inbound">
          <label for="from">From</label>
          ${
            phoneOptions
              ? `<select id="from" name="from">${phoneOptions}</select>`
              : `<input id="from" name="from" placeholder="+15551234567" required>`
          }
          <label for="text">Message</label>
          <textarea id="text" name="text" rows="3" required placeholder="Remind me to call the dentist tomorrow at 9"></textarea>
          <button type="submit">Send</button>
        </form>
      </section>`
    : '';

  const rowHtml = rows
    .map(
      (row) =>
        `<div class="row"><dt>${escapeHtml(row.label)}</dt><dd class="${row.tone}">${escapeHtml(row.value)}</dd></div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(config.assistantName)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #e7e1d6;
      color: #1c1915;
      font: 16px/1.5 "Segoe UI", system-ui, sans-serif;
    }
    main { max-width: 40rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
    .eyebrow { margin: 0 0 0.35rem; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.75rem; color: #6b645c; }
    h1 { font-family: Georgia, "Iowan Old Style", serif; font-size: 3rem; line-height: 1; margin: 0 0 0.75rem; font-weight: 500; }
    h2 { font-family: Georgia, "Iowan Old Style", serif; font-weight: 500; font-size: 1.4rem; margin: 0 0 0.75rem; }
    .intro { margin: 0 0 1.5rem; font-size: 1.05rem; }
    .card { background: #fbf8f3; border-radius: 18px; padding: 1.25rem 1.25rem 1.4rem; margin: 0 0 1rem; box-shadow: 0 1px 0 rgba(28, 25, 21, 0.04); }
    .row { display: grid; grid-template-columns: 8.5rem 1fr; gap: 0.75rem; padding: 0.7rem 0; border-top: 1px solid #e6dfd4; }
    .row:first-child { border-top: 0; padding-top: 0; }
    dt { color: #6b645c; }
    dd { margin: 0; }
    .ok { color: #1f6b4a; }
    .warn { color: #8a4b12; }
    .muted { color: #6b645c; }
    .lede { color: #4e4842; margin-top: 0; }
    .banner { white-space: pre-wrap; background: #f3ead4; border-radius: 12px; padding: 0.8rem 1rem; margin: 0 0 1rem; }
    .banner.warn { background: #f6e4d8; }
    .thread { display: flex; flex-direction: column; gap: 0.6rem; margin: 0 0 1rem; }
    .bubble { max-width: 85%; border-radius: 16px; padding: 0.65rem 0.85rem; }
    .bubble p { margin: 0; white-space: pre-wrap; }
    .bubble.user { align-self: flex-end; background: #1f6b4a; color: #f7fbf8; }
    .bubble.assistant { align-self: flex-start; background: #fff; border: 1px solid #e6dfd4; }
    .who { display: block; font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.7; margin-bottom: 0.2rem; }
    .empty { color: #6b645c; margin-top: 0; }
    label { display: block; font-size: 0.85rem; margin: 0.6rem 0 0.25rem; }
    input, select, textarea {
      width: 100%;
      font: inherit;
      padding: 0.65rem 0.75rem;
      border-radius: 12px;
      border: 1px solid #d9d0c4;
      background: #fff;
      color: inherit;
    }
    button {
      margin-top: 0.8rem;
      background: #1c1915;
      color: #fbf8f3;
      border: 0;
      border-radius: 999px;
      padding: 0.7rem 1.2rem;
      font: inherit;
      cursor: pointer;
    }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
      outline: 2px solid #1f6b4a;
      outline-offset: 2px;
    }
    footer { color: #6b645c; font-size: 0.9rem; }
    @media (max-width: 640px) {
      h1 { font-size: 2.4rem; }
      .row { grid-template-columns: 1fr; gap: 0.15rem; }
    }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">WhatsApp assistant</p>
    <h1>${escapeHtml(config.assistantName)}</h1>
    <p class="intro">${escapeHtml(config.assistantName)} texts with ${escapeHtml(config.ownerName)}. It looks things up, keeps notes, and sets reminders. Anything hard to undo waits for a YES.</p>
    <section class="card">
      <h2>This server</h2>
      <dl>${rowHtml}</dl>
    </section>
    ${consoleBlock}
    <footer>Health check: <a href="/health">/health</a>. Secrets stay in environment variables and are not shown here.</footer>
  </main>
</body>
</html>`;
}
