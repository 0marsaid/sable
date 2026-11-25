import type { TranscriptItem } from '../store.js';
import { WEBGPU_FALLBACK } from './device.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clock(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
}

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: #d7cec2;
    color: #1c1915;
    font: 16px/1.45 "Segoe UI", system-ui, sans-serif;
  }
  button, input, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; }
  .sr {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .login {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 24px 16px;
  }
  .login-card {
    width: min(100%, 400px);
    background: #f7f1e8;
    border-radius: 28px;
    padding: 36px 28px 28px;
    box-shadow: 0 20px 50px rgba(48, 36, 22, 0.12);
  }
  .mark {
    margin: 0;
    font-family: Georgia, "Iowan Old Style", serif;
    font-size: 40px;
    line-height: 1;
    letter-spacing: -0.03em;
  }
  .login h1 { font-size: 22px; font-weight: 650; margin: 18px 0 8px; }
  .lede { margin: 0 0 22px; color: #5e564e; }
  .banner {
    background: #f6e4d8;
    color: #6d3a16;
    border-radius: 14px;
    padding: 10px 12px;
    margin: 0 0 14px;
  }
  label { display: block; font-size: 14px; margin-bottom: 6px; }
  input[type="password"], textarea, .composer input[type="text"] {
    width: 100%;
    border: 1px solid #ddd4c8;
    background: #fff;
    border-radius: 14px;
    padding: 12px 14px;
    font-size: 16px;
  }
  input:focus-visible, textarea:focus-visible, button:focus-visible {
    outline: 2px solid #1f6b4a;
    outline-offset: 2px;
  }
  .primary, .send {
    border: 0;
    background: #1c1915;
    color: #f7f1e8;
  }
  .primary {
    width: 100%;
    margin-top: 14px;
    border-radius: 999px;
    padding: 12px 16px;
  }
  .primary:disabled { opacity: 0.45; cursor: not-allowed; }
  .shell {
    height: 100dvh;
    max-width: 480px;
    margin: 0 auto;
    background: #efe6da;
    display: flex;
    flex-direction: column;
  }
  header.app-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: #f7f1e8;
    border-bottom: 1px solid #e4dacd;
  }
  .avatar {
    width: 40px; height: 40px; border-radius: 50%;
    background: #1f6b4a; color: #f4fbf7;
    display: grid; place-items: center;
    font-family: Georgia, serif; font-size: 20px; flex: none;
  }
  .who-block { min-width: 0; flex: 1; }
  .who-block strong { display: block; font-size: 17px; }
  .who-block span { color: #6d645c; font-size: 13px; }
  .icon-btn {
    border: 0; background: transparent; color: #3d3833;
    width: 40px; height: 40px; border-radius: 50%;
    display: grid; place-items: center;
  }
  .icon-btn:hover { background: rgba(28, 25, 21, 0.06); }
  .thread {
    flex: 1;
    overflow-y: auto;
    padding: 16px 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty { color: #6d645c; text-align: center; margin: auto; max-width: 260px; }
  .bubble { max-width: 82%; padding: 8px 12px 6px; border-radius: 18px; }
  .bubble p { margin: 0; white-space: pre-wrap; word-wrap: break-word; }
  .bubble time { display: block; margin-top: 4px; font-size: 11px; opacity: 0.65; }
  .bubble.user { align-self: flex-end; background: #1f6b4a; color: #f4fbf7; border-bottom-right-radius: 6px; }
  .bubble.assistant { align-self: flex-start; background: #fff; border-bottom-left-radius: 6px; box-shadow: 0 1px 0 rgba(28, 25, 21, 0.04); }
  .bubble.reminder { background: #fff8ea; }
  .photo-tag {
    display: inline-block; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase;
    background: rgba(28, 25, 21, 0.08); border-radius: 999px; padding: 2px 8px; margin-bottom: 4px;
  }
  .bubble.user .photo-tag { background: rgba(255, 255, 255, 0.18); }
  .typing { align-self: flex-start; }
  .dots { display: flex; gap: 4px; height: 18px; align-items: center; }
  .dots i {
    width: 7px; height: 7px; border-radius: 50%; background: #8a8178;
    animation: blink 1.2s infinite; display: block;
  }
  .dots i:nth-child(2) { animation-delay: 0.15s; }
  .dots i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
  .approval {
    margin: 0 12px 8px;
    background: #fff;
    border-radius: 18px;
    padding: 12px;
    box-shadow: 0 8px 24px rgba(48, 36, 22, 0.06);
  }
  .approval p { margin: 0 0 8px; }
  .approval ul { margin: 0 0 12px; padding-left: 18px; }
  .choices { display: flex; gap: 8px; }
  .choices button { flex: 1; border-radius: 999px; padding: 10px 12px; }
  .choices .no { background: #fff; border: 1px solid #d9d0c4; }
  .choices .yes { background: #1f6b4a; color: #f4fbf7; border: 0; }
  .composer-wrap { padding: 8px 10px calc(10px + env(safe-area-inset-bottom)); background: #f7f1e8; }
  .preview { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 8px; color: #3d3833; }
  .preview button { border: 0; background: transparent; text-decoration: underline; }
  .composer { display: flex; align-items: flex-end; gap: 6px; }
  textarea {
    resize: none; min-height: 44px; max-height: 120px; border-radius: 22px; padding: 11px 14px;
  }
  .send, .clip {
    width: 44px; height: 44px; border-radius: 50%; flex: none;
    display: grid; place-items: center;
  }
  .clip { border: 0; background: transparent; }
  .send:disabled { opacity: 0.35; }
  .note { color: #8a4b12; font-size: 13px; margin: 0 0 8px; }
  @media (min-width: 760px) {
    body:not(.login) { display: grid; place-items: center; padding: 24px; }
    .shell {
      height: min(860px, calc(100dvh - 48px));
      width: min(480px, 100%);
      border-radius: 28px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(48, 36, 22, 0.16);
    }
  }
  @media (max-width: 759px) {
    body { background: #efe6da; }
    .shell { max-width: none; }
  }
  .setup, .settings, .webgpu {
    position: absolute; inset: 0; background: rgba(215, 206, 194, 0.72);
    display: grid; place-items: center; padding: 20px; z-index: 2;
  }
  .shell { position: relative; }
  .setup-card {
    width: min(100%, 420px); background: #f7f1e8; border-radius: 28px; padding: 28px 24px;
    box-shadow: 0 20px 50px rgba(48, 36, 22, 0.16);
  }
  .setup-card h2 { font-family: Georgia, serif; font-weight: 500; font-size: 28px; margin: 8px 0; }
  progress { width: 100%; height: 10px; border: 0; border-radius: 999px; overflow: hidden; }
  progress::-webkit-progress-bar { background: #e6dfd4; }
  progress::-webkit-progress-value { background: #1f6b4a; }
  fieldset { border: 0; padding: 0; margin: 0 0 14px; }
  fieldset label { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
  select { width: 100%; padding: 10px 12px; border-radius: 12px; border: 1px solid #ddd4c8; background: #fff; font: inherit; }
  [hidden] { display: none !important; }
`;

function documentShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#efe6da">
  <title>${escapeHtml(title)}</title>
  <style>${STYLES}</style>
</head>
${body}
</html>`;
}

export function renderLoginPage(options: {
  assistantName: string;
  ownerName: string;
  error?: 'password' | 'rate' | 'missing';
  passwordConfigured: boolean;
}): string {
  const banner =
    options.error === 'rate'
      ? '<p class="banner" role="alert">Too many tries. Wait a few minutes and try again.</p>'
      : options.error === 'password'
        ? '<p class="banner" role="alert">That password is not right.</p>'
        : options.error === 'missing'
          ? '<p class="banner" role="alert">Set APP_PASSWORD and restart before signing in.</p>'
          : '';
  const disabled = options.passwordConfigured ? '' : 'disabled';
  return documentShell(
    options.assistantName,
    `<body class="login">
  <main class="login-card">
    <p class="mark">${escapeHtml(options.assistantName)}</p>
    <h1>Text ${escapeHtml(options.ownerName)}’s assistant</h1>
    <p class="lede">This chat is private. There is no sign-up.</p>
    ${banner}
    <form method="post" action="/login">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required ${disabled}>
      <button class="primary" type="submit" ${disabled}>Continue</button>
    </form>
  </main>
</body>`,
  );
}

function bubbleHtml(item: TranscriptItem, assistantName: string, ownerName: string, timeZone: string): string {
  const photo = item.body.startsWith('[Photo]');
  const reminder = item.body.startsWith('Reminder:');
  const caption = photo ? item.body.replace(/^\[Photo\]\s?/, '') : item.body;
  const who = item.role === 'user' ? ownerName : assistantName;
  const tag = photo ? '<span class="photo-tag">Photo</span>' : '';
  return `<article class="bubble ${item.role}${reminder ? ' reminder' : ''}" data-id="${escapeHtml(item.id)}">
    <span class="sr">${escapeHtml(who)}</span>
    ${tag}
    <p>${escapeHtml(caption)}</p>
    <time datetime="${escapeHtml(item.at)}">${escapeHtml(clock(item.at, timeZone))}</time>
  </article>`;
}

export function renderChatPage(options: {
  assistantName: string;
  ownerName: string;
  timezone: string;
  items: TranscriptItem[];
  pending: { summaries: string[] } | null;
}): string {
  const thread = options.items.length
    ? options.items
        .map((item) => bubbleHtml(item, options.assistantName, options.ownerName, options.timezone))
        .join('')
    : '<p class="empty" id="empty">Say hello, or try /note and /remind. /help lists commands.</p>';
  const approval = options.pending
    ? `<form class="approval" method="post" action="/api/messages" data-approval>
        <p>I need a yes before I do this.</p>
        <ul>${options.pending.summaries.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        <div class="choices">
          <button class="no" type="submit" name="text" value="no" data-decision="no">No</button>
          <button class="yes" type="submit" name="text" value="yes" data-decision="yes">Yes</button>
        </div>
      </form>`
    : '';
  return documentShell(
    options.assistantName,
    `<body data-assistant="${escapeHtml(options.assistantName)}" data-owner="${escapeHtml(options.ownerName)}" data-tz="${escapeHtml(options.timezone)}">
  <div class="shell">
    <div id="setup" class="setup" hidden>
      <div class="setup-card">
        <p class="mark">Sable</p>
        <h2>Downloading the on-device model</h2>
        <p>This happens once. The file stays in this browser, so later visits work offline.</p>
        <p id="setup-label"></p>
        <progress id="setup-bar" max="1" value="0"></progress>
        <p id="setup-status">Starting…</p>
      </div>
    </div>
    <div id="webgpu" class="webgpu" hidden>
      <div class="setup-card">
        <p class="mark">Sable</p>
        <h2>No on-device model here</h2>
        <p id="webgpu-copy">${escapeHtml(WEBGPU_FALLBACK)}</p>
        <button class="primary" id="use-server" type="button" hidden>Use the hosted model</button>
      </div>
    </div>
    <div id="settings" class="settings" hidden>
      <div class="setup-card">
        <h2>Settings</h2>
        <fieldset>
          <legend>Where answers come from</legend>
          <label><input type="radio" name="engine" value="device"> On this device</label>
          <label><input type="radio" name="engine" value="server"> Hosted model</label>
        </fieldset>
        <p id="server-hint" class="lede"></p>
        <label for="model">On-device model</label>
        <select id="model"></select>
        <button class="primary" id="settings-close" type="button">Done</button>
      </div>
    </div>
    <header class="app-bar">
      <div class="avatar" aria-hidden="true">${escapeHtml(options.assistantName.slice(0, 1))}</div>
      <div class="who-block">
        <strong>${escapeHtml(options.assistantName)}</strong>
        <span>Private</span>
      </div>
      <button class="icon-btn" id="settings-open" type="button" title="Settings" aria-label="Settings">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></svg>
      </button>
      <button class="icon-btn" id="notify" type="button" title="Allow reminder notifications" aria-label="Allow reminder notifications">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>
      </button>
      <form method="post" action="/logout">
        <button class="icon-btn" type="submit" aria-label="Log out" title="Log out">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 6H5v12h4"/><path d="M10 12h9"/><path d="M16 8l4 4-4 4"/></svg>
        </button>
      </form>
    </header>
    <div class="thread" id="thread" aria-live="polite">${thread}
      <div class="bubble assistant typing" id="typing" hidden>
        <div class="dots" aria-label="${escapeHtml(options.assistantName)} is typing"><i></i><i></i><i></i></div>
      </div>
      <div id="end"></div>
    </div>
    ${approval}
    <div class="composer-wrap">
      <p class="note" id="form-error" hidden></p>
      <div class="preview" id="preview" hidden>
        <span id="preview-name">Photo</span>
        <button type="button" id="clear-photo">Remove</button>
      </div>
      <form class="composer" id="composer" method="post" action="/api/messages">
        <label class="sr" for="text">Message</label>
        <button class="clip" type="button" id="pick" aria-label="Add a photo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-9 9"/></svg>
        </button>
        <input id="photo" class="sr" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
        <textarea id="text" name="text" rows="1" placeholder="Message" enterkeyhint="send"></textarea>
        <button class="send" type="submit" aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
        </button>
      </form>
    </div>
  </div>
  <script>${CLIENT}</script>
</body>`,
  );
}

const CLIENT = `
(async () => {
  const thread = document.getElementById('thread');
  const typing = document.getElementById('typing');
  const composer = document.getElementById('composer');
  const text = document.getElementById('text');
  const photo = document.getElementById('photo');
  const preview = document.getElementById('preview');
  const previewName = document.getElementById('preview-name');
  const formError = document.getElementById('form-error');
  const assistant = document.body.dataset.assistant || 'Sable';
  const owner = document.body.dataset.owner || 'You';
  const tz = document.body.dataset.tz || 'UTC';
  let file = null;
  let sending = false;
  let appConfig = null;
  let engineName = 'device';
  let modelId = '';
  let mlc = null;
  let modelReady = false;

  function clock(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(date);
  }

  function bubble(item) {
    const article = document.createElement('article');
    const photoMsg = item.body.startsWith('[Photo]');
    const reminder = item.body.startsWith('Reminder:');
    article.className = 'bubble ' + item.role + (reminder ? ' reminder' : '');
    article.dataset.id = item.id;
    const who = document.createElement('span');
    who.className = 'sr';
    who.textContent = item.role === 'user' ? owner : assistant;
    article.appendChild(who);
    if (photoMsg) {
      const tag = document.createElement('span');
      tag.className = 'photo-tag';
      tag.textContent = 'Photo';
      article.appendChild(tag);
    }
    const p = document.createElement('p');
    p.textContent = photoMsg ? item.body.replace(/^\\[Photo\\]\\s?/, '') : item.body;
    article.appendChild(p);
    const time = document.createElement('time');
    time.dateTime = item.at;
    time.textContent = clock(item.at);
    article.appendChild(time);
    return article;
  }

  function render(data) {
    const end = document.getElementById('end');
    const anchor = typing.parentElement === thread ? typing : end;
    thread.querySelectorAll('.bubble, .empty').forEach((node) => {
      if (node.id !== 'typing') node.remove();
    });
    if (!data.items.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.id = 'empty';
      empty.textContent = 'Say hello, or try /note and /remind. /help lists commands.';
      thread.insertBefore(empty, anchor);
    } else {
      for (const item of data.items) thread.insertBefore(bubble(item), anchor);
    }
    let card = document.querySelector('[data-approval]');
    if (data.pending && data.pending.summaries && data.pending.summaries.length) {
      if (!card) {
        card = document.createElement('form');
        card.className = 'approval';
        card.method = 'post';
        card.action = '/api/messages';
        card.dataset.approval = '';
        card.addEventListener('submit', onSubmit);
        document.querySelector('.composer-wrap').before(card);
      }
      card.replaceChildren();
      const lead = document.createElement('p');
      lead.textContent = 'I need a yes before I do this.';
      const list = document.createElement('ul');
      for (const line of data.pending.summaries) {
        const li = document.createElement('li');
        li.textContent = line;
        list.appendChild(li);
      }
      const choices = document.createElement('div');
      choices.className = 'choices';
      for (const [label, value, cls] of [['No', 'no', 'no'], ['Yes', 'yes', 'yes']]) {
        const button = document.createElement('button');
        button.type = 'submit';
        button.name = 'text';
        button.value = value;
        button.dataset.decision = value;
        button.className = cls;
        button.textContent = label;
        choices.appendChild(button);
      }
      card.append(lead, list, choices);
    } else if (card) {
      card.remove();
    }
    end.scrollIntoView();
  }

  async function refresh() {
    const res = await fetch('/api/transcript');
    if (res.status === 401) { location.href = '/'; return; }
    if (!res.ok) return;
    render(await res.json());
  }

  function showError(message) {
    formError.hidden = !message;
    formError.textContent = message || '';
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (sending) return;
    const submitter = event.submitter;
    const decision = submitter && submitter.name === 'text' ? submitter.value : '';
    const caption = decision || text.value.trim();
    if (!caption && !file) return;
    sending = true;
    showError('');
    typing.hidden = false;
    const payload = { text: caption, engine: engineName };
    if (!decision && file) payload.image = file;
    const command = caption.startsWith('/');
    if (!command && !decision && engineName === 'device' && !modelReady && !file) {
      showError('The on-device model is still loading. /note and /remind work now.');
      sending = false;
      typing.hidden = true;
      return;
    }
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) { location.href = '/'; return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'Message not sent. Try again.');
        return;
      }
      text.value = '';
      file = null;
      photo.value = '';
      preview.hidden = true;
      render(data);
      if (data.needsModel) await runDeviceModel(data);
    } catch {
      showError('Message not sent. Check your connection and try again.');
    } finally {
      sending = false;
      typing.hidden = true;
    }
  }

  async function runDeviceModel(data) {
    if (!mlc) {
      showError('The on-device model is not ready yet.');
      return;
    }
    const messages = [{ role: 'system', content: data.context.system }].concat(data.context.messages);
    const reply = await mlc.chat.completions.create({ messages: messages, temperature: 0.3, max_tokens: 300 });
    const content = reply && reply.choices && reply.choices[0] && reply.choices[0].message
      ? reply.choices[0].message.content
      : '';
    const saved = await fetch('/api/device-reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: content || '…' }),
    });
    if (saved.ok) render(await saved.json());
  }

  composer.addEventListener('submit', onSubmit);
  document.querySelector('[data-approval]')?.addEventListener('submit', onSubmit);
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  text.addEventListener('input', () => {
    text.style.height = 'auto';
    text.style.height = Math.min(text.scrollHeight, 120) + 'px';
  });
  document.getElementById('pick').addEventListener('click', () => photo.click());
  photo.addEventListener('change', () => {
    const picked = photo.files && photo.files[0];
    if (!picked) return;
    if (picked.size > 4 * 1024 * 1024) {
      showError('Keep photos under 4 MB.');
      photo.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      file = { mimeType: picked.type || 'image/jpeg', data: comma >= 0 ? result.slice(comma + 1) : result };
      previewName.textContent = picked.name || 'Photo';
      preview.hidden = false;
    };
    reader.readAsDataURL(picked);
  });
  document.getElementById('clear-photo').addEventListener('click', () => {
    file = null;
    photo.value = '';
    preview.hidden = true;
  });
  document.getElementById('notify').addEventListener('click', async () => {
    if (!('Notification' in window)) { showError('This browser cannot show notifications.'); return; }
    const permission = await Notification.requestPermission();
    showError(permission === 'granted' ? '' : 'Notifications stay off until you allow them.');
  });
  document.getElementById('end').scrollIntoView();

  if (window.EventSource) {
    const events = new EventSource('/api/events');
    const onPush = (event) => {
      refresh();
      if (event.type !== 'reminder' || !('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        const data = JSON.parse(event.data);
        new Notification(assistant, { body: data.text || 'Reminder' });
      } catch { /* ignore a bad event */ }
    };
    events.addEventListener('delivery', onPush);
    events.addEventListener('reminder', onPush);
  }
  setInterval(refresh, 15000);

  function isPhone() {
    return window.matchMedia('(max-width: 759px)').matches;
  }

  function formatSize(mb) {
    if (mb >= 1000) return (mb / 1000).toFixed(1) + ' GB';
    return mb + ' MB';
  }

  function preferredModel() {
    const tier = isPhone() ? 'phone' : 'computer';
    return appConfig.models.find((model) => model.tier === tier && model.preferred) || appConfig.models[0];
  }

  function showSetup(model) {
    document.getElementById('webgpu').hidden = true;
    document.getElementById('setup').hidden = false;
    document.getElementById('setup-label').textContent = model.label + ' · about ' + formatSize(model.sizeMb);
    document.getElementById('setup-bar').value = 0;
    document.getElementById('setup-status').textContent = 'Starting the download…';
  }

  async function loadModel() {
    const model = appConfig.models.find((item) => item.id === modelId) || preferredModel();
    modelId = model.id;
    localStorage.setItem('sable.model', modelId);
    showSetup(model);
    modelReady = false;
    try {
      const webllm = await import('https://esm.sh/@mlc-ai/web-llm@0.2.89');
      if (mlc && mlc.unload) await mlc.unload();
      mlc = await webllm.CreateMLCEngine(model.id, {
        initProgressCallback: (report) => {
          document.getElementById('setup-bar').value = report.progress || 0;
          document.getElementById('setup-status').textContent = report.text || 'Downloading…';
        },
      });
      modelReady = true;
      document.getElementById('setup').hidden = true;
    } catch (error) {
      modelReady = false;
      document.getElementById('setup-status').textContent = 'The model did not load. /note and /remind still work.';
    }
  }

  function fillSettings() {
    const select = document.getElementById('model');
    select.replaceChildren();
    for (const model of appConfig.models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.label + ' · ' + formatSize(model.sizeMb) + ' · ' + model.detail;
      if (model.id === modelId) option.selected = true;
      select.appendChild(option);
    }
    document.querySelectorAll('input[name="engine"]').forEach((input) => {
      input.checked = input.value === engineName;
      if (input.value === 'server') input.disabled = !appConfig.serverAvailable;
    });
    document.getElementById('server-hint').textContent = appConfig.serverAvailable
      ? 'The hosted model uses the key on the server.'
      : 'Set LLM_API_KEY on the server to unlock the hosted model.';
  }

  function applyEngine(next, persist) {
    engineName = next;
    if (persist) localStorage.setItem('sable.engine', next);
    if (next === 'server') {
      document.getElementById('setup').hidden = true;
      document.getElementById('webgpu').hidden = true;
      return;
    }
    if (!navigator.gpu) {
      document.getElementById('setup').hidden = true;
      document.getElementById('webgpu').hidden = false;
      document.getElementById('webgpu-copy').textContent = appConfig.webgpuMessage;
      document.getElementById('use-server').hidden = !appConfig.serverAvailable;
      return;
    }
    loadModel();
  }

  document.getElementById('settings-open').addEventListener('click', () => {
    fillSettings();
    document.getElementById('settings').hidden = false;
  });
  document.getElementById('settings-close').addEventListener('click', () => {
    const selected = document.querySelector('input[name="engine"]:checked');
    const nextEngine = selected ? selected.value : engineName;
    const nextModel = document.getElementById('model').value;
    document.getElementById('settings').hidden = true;
    const modelChanged = nextModel && nextModel !== modelId;
    if (modelChanged) {
      modelId = nextModel;
      localStorage.setItem('sable.model', modelId);
    }
    if (nextEngine !== engineName || (nextEngine === 'device' && modelChanged)) applyEngine(nextEngine, true);
  });
  document.getElementById('use-server').addEventListener('click', () => applyEngine('server', true));

  const configResponse = await fetch('/api/config');
  if (configResponse.ok) {
    appConfig = await configResponse.json();
    const savedEngine = localStorage.getItem('sable.engine');
    const savedModel = localStorage.getItem('sable.model');
    modelId = savedModel || preferredModel().id;
    let next = savedEngine === 'device' || savedEngine === 'server' ? savedEngine : appConfig.defaultEngine;
    if (next === 'server' && !appConfig.serverAvailable) next = 'device';
    if (next === 'device' && !navigator.gpu && appConfig.serverAvailable) next = 'server';
    applyEngine(next, false);
  }
})();
`;
