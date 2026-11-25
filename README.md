# Sable

Sable is a personal assistant you text on WhatsApp. It is built for one owner. It looks things up, reads a link, remembers facts about you, keeps notes and to-dos, and texts you back when a reminder is due.

Anything hard to undo waits for a reply of **YES**. Search, notes, and saving a fact happen immediately. Reminders, deleting a note, forgetting a fact, and cancelling a reminder do not run until you confirm.

You host it yourself. The language model is any OpenAI-compatible API. WhatsApp is the official Meta Cloud API, with Twilio’s sandbox as an optional second adapter.

## What you need to create

| Account | Required? | What it gives you |
| --- | --- | --- |
| [Meta for Developers](https://developers.facebook.com/) app with WhatsApp | Yes, for real WhatsApp. Skip it for a local dry run. | Verify token (you invent this), access token, phone number ID, app secret |
| An OpenAI-compatible model provider (OpenAI, OpenRouter, Groq, …) | Yes, for real answers | `LLM_API_KEY`, and a base URL if it is not OpenAI |
| Your own WhatsApp number | Yes | The only number Sable will answer. This is `OWNER_PHONE_NUMBERS` |
| [Tavily](https://tavily.com) or [Brave Search](https://brave.com/search/api/) | No | Web search. Notes and reminders work without it |
| [ngrok](https://ngrok.com) or similar | Only while testing on your laptop | A public https URL for Meta’s webhook |
| [Render](https://render.com), [Railway](https://railway.com), or [Fly.io](https://fly.io) | When you want it online all the time | A host that stays awake so reminders can be sent |

Twilio is an alternative to Meta, not an extra requirement. The [Twilio WhatsApp sandbox](https://www.twilio.com/docs/whatsapp/sandbox) is faster to try and less suitable as a permanent number.

## Run it on your machine

You need Node.js 22 or newer.

```bash
cp .env.example .env
```

Put your WhatsApp number in `.env`:

```bash
OWNER_PHONE_NUMBERS=+15551234567
OWNER_NAME=Omar
OWNER_TIMEZONE=America/Los_Angeles
```

Install and start:

```bash
npm install
npm run dev
```

Open [http://localhost:8787](http://localhost:8787). The page shows what is configured and what is still missing. It never prints secrets.

### Dry run with no keys

In `.env`:

```bash
LLM_MODE=mock
WHATSAPP_PROVIDER=console
OWNER_PHONE_NUMBERS=+15551234567
META_VERIFY_TOKEN=choose-a-long-random-string
```

`LLM_MODE=mock` echoes your text and does not call tools or spend money. `WHATSAPP_PROVIDER=console` keeps replies on the status page. Do not expose console mode on the public internet: anyone who can open the page can type a message as if they were you.

Check the webhook the way Meta will:

```bash
curl -s "http://localhost:8787/webhook?hub.mode=subscribe&hub.verify_token=choose-a-long-random-string&hub.challenge=1158201444"
```

That prints `1158201444`.

Send a fake inbound message and read the reply:

```bash
curl -s -X POST http://localhost:8787/webhook \
  -H 'content-type: application/json' \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "15551234567",
            "id": "wamid.LOCAL",
            "timestamp": "1710000000",
            "type": "text",
            "text": { "body": "Hello" }
          }]
        }
      }]
    }]
  }'
curl -s http://localhost:8787/debug/outbox
```

With the mock model the outbox contains `You said: Hello`. The same message can be typed into the box on the home page.

## Connect Meta WhatsApp

Do this once. The test number Meta gives you is enough to text yourself. You do not need business verification for that. A test number can only message phone numbers you have registered, and only a handful of them.

### 1. Create the app

1. Go to [developers.facebook.com](https://developers.facebook.com/) and sign in.
2. **My Apps → Create App**.
3. Choose the **Business** type. If the form asks for a use case, pick **Connect with customers through WhatsApp**.
4. Name the app, create it, and add the **WhatsApp** product if it is not already there.

### 2. Copy the test number and phone number ID

Open **WhatsApp → API Setup** (on newer apps this is under **Use cases → Customize → Configuration**).

Write down:

- the **test phone number** Meta shows (this is the number you will text)
- the **Phone number ID** (a long number, not the phone number itself)
- the temporary **access token** (it expires in about 24 hours; you will replace it below)

In **To**, choose **Manage phone number list** and add your own mobile number. WhatsApp sends you a code. Enter it. Until you do this, the test number will not deliver messages to you.

### 3. Choose a verify token and run Sable

Invent a long random string. It is not a password Meta gives you. Put it in `.env` as `META_VERIFY_TOKEN`, and also put the phone number ID in:

```bash
WHATSAPP_PROVIDER=meta
META_VERIFY_TOKEN=the-string-you-invented
META_PHONE_NUMBER_ID=the-phone-number-id
META_ACCESS_TOKEN=the-temporary-token
META_APP_SECRET=
LLM_MODE=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
OWNER_PHONE_NUMBERS=+1yournumber
```

Leave `META_APP_SECRET` empty until the webhook is verified. Start Sable with `npm run dev`.

### 4. Give Meta a public URL

Meta cannot call `localhost`. In another terminal:

```bash
ngrok http 8787
```

ngrok prints an https address such as `https://abcd-1234.ngrok-free.app`. Set that as `PUBLIC_BASE_URL` in `.env` and restart Sable.

In the WhatsApp **Configuration** page:

- Callback URL: `https://abcd-1234.ngrok-free.app/webhook`
- Verify token: the same string as `META_VERIFY_TOKEN`
- Click **Verify and save**

If verification fails, the curl command in the dry-run section should succeed locally with the same token. Then check that ngrok is still running and that the path is `/webhook`.

After it saves, subscribe to the **messages** field. Without that subscription Meta verifies the URL and then never delivers texts.

### 5. Make a token that does not expire tomorrow

The token on the API Setup page dies within a day. Replace it with a system user token:

1. Open [business.facebook.com/settings](https://business.facebook.com/settings/system-users) → **Users → System users**.
2. **Add**. Name it `sable`. **Employee** is enough if you then grant it the WhatsApp account. **Admin** is simpler if this business only exists for Sable.
3. **Assign assets**. Select your app and grant **Manage app**. Also assign the WhatsApp account (and the messaging account, if it is listed separately) with full control.
4. **Generate token**. Choose your app, set expiration to **Never**, and include:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Copy the token into `META_ACCESS_TOKEN` and restart. You cannot view it again later. Store it only in `.env` or your host’s secret manager.

Then open the app’s **App settings → Basic**, reveal the **App secret**, and set `META_APP_SECRET`. Sable checks `X-Hub-Signature-256` on every webhook once this is set. If you set it and Meta suddenly gets HTTP 403, the secret does not match the app that is sending the webhook.

### 6. Text it

Send a WhatsApp message to the test number. Sable replies in that chat. Only `OWNER_PHONE_NUMBERS` gets a reply; other senders are ignored and the webhook still returns 200 so Meta does not retry forever.

Photos are sent to the model. Voice notes, videos, stickers, and documents get a short “I can’t open that” reply.

### The 24-hour window, and reminders

WhatsApp lets a business send a free-form reply for 24 hours after you text it. Normal back-and-forth works inside that window.

A reminder is Sable texting you first. If your last message was more than 24 hours ago, Meta may reject the free-form reminder. To make reminders reliable, create a utility template:

1. In WhatsApp Manager, **Message templates → Create template**.
2. Category: **Utility**. Name: `sable_reminder`. Language: English.
3. Body: `Reminder: {{1}}`
4. Submit it and wait until the status is **Approved**.

Then set:

```bash
META_REMINDER_TEMPLATE=sable_reminder
META_REMINDER_TEMPLATE_LANG=en
```

Sable sends that template for reminders and keeps ordinary replies as free-form text. The template variable is the reminder itself, so a reminder to call the dentist arrives as “Reminder: Call the dentist”.

## Twilio sandbox instead of Meta

Use this when you want a quicker test. Set:

```bash
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
PUBLIC_BASE_URL=https://your-public-host
```

`TWILIO_WHATSAPP_FROM` is the sandbox number shown in the [Twilio console](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn), usually `whatsapp:+14155238886`. Join the sandbox by texting the join code to that number from your phone.

Webhook URL (method POST):

```text
https://your-public-host/webhook/twilio
```

When both `TWILIO_AUTH_TOKEN` and `PUBLIC_BASE_URL` are set, Sable checks `X-Twilio-Signature`. The public URL must be exactly the URL Twilio calls, including `https`.

## Language model

Any server that implements `POST {base}/chat/completions` with tool calling works.

```bash
LLM_MODE=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

`LLM_BASE_URL` includes the `/v1` prefix and does not include `/chat/completions`. For OpenRouter that is `https://openrouter.ai/api/v1`. For Groq it is `https://api.groq.com/openai/v1`. The model you pick has to support tool calling. Photos need a vision model; set `LLM_VISION_MODEL` if that is a different model than `LLM_MODEL`.

`gpt-4o-mini` does both tools and photos.

## Web search

```bash
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=tvly-...
```

or

```bash
SEARCH_PROVIDER=brave
BRAVE_API_KEY=...
```

If `SEARCH_PROVIDER` is left as `none` and a key is present, Sable picks the provider that has a key. Fetching a link does not need a search key. Private addresses, localhost, and link-local hosts are refused.

## Deploy

Sable has to stay running. Reminders are sent by this process, and the SQLite database is a file. Use one instance and a persistent disk. An ephemeral filesystem will forget Omar’s notes on every deploy.

The container listens on `PORT` (Render and Railway set this) and writes the database to `DATABASE_PATH`. In the included configs that path is `/data/sable.db`.

Set `PUBLIC_BASE_URL` to the https origin the host gives you, with no trailing slash, and use `https://that-host/webhook` as the Meta callback.

### Render

`render.yaml` is a Blueprint. In the Render dashboard: **New → Blueprint**, select the repo, and fill the secrets it prompts for (`OWNER_PHONE_NUMBERS`, `LLM_API_KEY`, the Meta values, `PUBLIC_BASE_URL`). The file attaches a 1 GB disk at `/data` and uses the starter plan so the service does not sleep. Free instances sleep, and a sleeping process cannot deliver a reminder.

### Railway

`railway.json` builds the Dockerfile and checks `/health`.

1. **New project → Deploy from GitHub** and choose this repo.
2. Add a volume mounted at `/data`.
3. Set the variables from `.env.example`, including `DATABASE_PATH=/data/sable.db` and `WHATSAPP_PROVIDER=meta`.
4. Generate a domain. Put `https://that-domain` in `PUBLIC_BASE_URL` and in the Meta callback as `https://that-domain/webhook`.

### Fly.io

`fly.toml` keeps one machine running (`auto_stop_machines = "off"`) and mounts a volume at `/data`.

```bash
fly launch --no-deploy
fly volumes create sable_data --size 1 --region iad
fly secrets set \
  OWNER_PHONE_NUMBERS='+15551234567' \
  OWNER_TIMEZONE='America/Los_Angeles' \
  LLM_API_KEY='sk-...' \
  META_VERIFY_TOKEN='...' \
  META_ACCESS_TOKEN='...' \
  META_PHONE_NUMBER_ID='...' \
  META_APP_SECRET='...' \
  PUBLIC_BASE_URL='https://your-app.fly.dev'
fly deploy
```

The volume name `sable_data` has to match `fly.toml`. Change the `app` name in `fly.toml` to the name Fly gave you.

## How a message is handled

1. Meta or Twilio calls the webhook. Sable answers 200 right away, then works.
2. The sender must be on `OWNER_PHONE_NUMBERS`. Everyone else is dropped.
3. The same provider message id is stored, so a retry does not get two replies.
4. Photos are downloaded and sent to the model. Other attachments get a plain refusal.
5. Recent messages and the saved facts go to the model with the tool list.
6. Safe tools run immediately. A sensitive tool is saved as a pending action and you get a summary. Nothing from that batch runs until you reply **YES**. **NO**, or any other message, cancels it. A confirmation expires after two hours.
7. Every 15 seconds, due reminders are claimed and sent. A failed send is retried up to three times.

## Tools

| Tool | Needs YES? | What it does |
| --- | --- | --- |
| `web_search` | No | Search via Tavily or Brave |
| `fetch_page` | No | Read a public web page |
| `remember_fact` / `list_facts` | No | Long-term memory, also injected into every prompt |
| `forget_fact` | Yes | Delete one fact |
| `add_note` / `list_notes` / `complete_todo` | No | Notes and to-dos |
| `delete_note` | Yes | Delete a note or to-do |
| `create_reminder` | Yes | Text you on WhatsApp at a time |
| `list_reminders` | No | Show what is scheduled |
| `cancel_reminder` | Yes | Cancel one |

To add a tool, create a `Tool` in `src/tools/` and spread it into `createTools()` in `src/tools/registry.ts`. Set `sensitive: true` if it sends, deletes, pays, or books. The approval step reads that flag. No other registration is required.

```ts
export function sendEmailTool(): Tool {
  return {
    name: 'send_email',
    sensitive: true,
    description: 'Send an email.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
    summarize: (args) => `Email ${String(args.to)}: ${String(args.subject)}`,
    async execute(args) {
      // call your mail provider here, then return a short result string
      return `Sent to ${String(args.to)}`;
    },
  };
}
```

Calendar, email, bookings, and phone calls belong in this list the same way. The model never gets a tool that can bypass the YES step: `sensitive` is enforced in the agent loop, not in the prompt.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port. Default `8787`. Hosts often set this for you. |
| `HOST` | Default `0.0.0.0`. |
| `ASSISTANT_NAME` | Default `Sable`. |
| `OWNER_NAME` | Default `Omar`. Used in the prompt. |
| `OWNER_TIMEZONE` | IANA name, such as `America/Los_Angeles`. |
| `OWNER_PHONE_NUMBERS` | Comma-separated numbers with country code. Empty means reply to nobody. |
| `DATABASE_PATH` | SQLite file. Default `./data/sable.db`. |
| `PUBLIC_BASE_URL` | Public https origin, no trailing slash. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error`. |
| `LLM_MODE` | `openai` or `mock`. |
| `LLM_BASE_URL` | Chat completions origin. Default `https://api.openai.com/v1`. |
| `LLM_API_KEY` | Model provider key. |
| `LLM_MODEL` | Default `gpt-4o-mini`. |
| `LLM_VISION_MODEL` | Optional model used only when a message includes a photo. |
| `WHATSAPP_PROVIDER` | `meta`, `twilio`, or `console`. Auto-detected from whichever keys exist. |
| `META_VERIFY_TOKEN` | The string you invented and typed into the Meta dashboard. |
| `META_ACCESS_TOKEN` | Permanent system-user token. |
| `META_PHONE_NUMBER_ID` | From WhatsApp API Setup. Not the phone number. |
| `META_APP_SECRET` | Turns on webhook signature checks. |
| `META_API_VERSION` | Default `v21.0`. |
| `META_REMINDER_TEMPLATE` | Optional approved template name for reminders. |
| `META_REMINDER_TEMPLATE_LANG` | Default `en`. |
| `TWILIO_ACCOUNT_SID` | Twilio account SID. |
| `TWILIO_AUTH_TOKEN` | Twilio auth token. |
| `TWILIO_WHATSAPP_FROM` | Default `whatsapp:+14155238886`. |
| `SEARCH_PROVIDER` | `tavily`, `brave`, or `none`. |
| `TAVILY_API_KEY` | Tavily key. |
| `BRAVE_API_KEY` | Brave Search key. |

Secrets are read from the environment only. Logs pass through a redactor for those values. Do not put tokens in the database path, the verify challenge, or the README.

## Tests

```bash
npm test
```

The suite covers webhook verification, signatures, the allowlist, a mocked inbound message producing a reply, the YES / NO approval flow, and reminder delivery. WhatsApp and the model are fakes. No network is required.

`npm run build` compiles TypeScript to `dist/`. `npm start` runs the compiled server.

## Troubleshooting

**Meta will not verify the webhook.** The verify token in the dashboard and `META_VERIFY_TOKEN` differ, ngrok is stopped, or the callback is missing `/webhook`. The curl check above should return the challenge before you involve Meta.

**You text the number and nothing happens.** Subscribe to the `messages` field. Your phone has to be a registered test recipient. `OWNER_PHONE_NUMBERS` has to be that same phone in international form. The status page shows how many numbers are allowlisted.

**Sable replies with a configuration sentence.** `LLM_API_KEY` is empty and `LLM_MODE` is not `mock`.

**Sends fail with HTTP 401 from Meta.** The temporary token expired. Generate the system-user token.

**Webhook posts return 403 after you set the app secret.** `META_APP_SECRET` is from a different app, or a proxy changed the raw body.

**A reminder never arrives.** The process was asleep or restarted onto a disk that does not have the database. On Meta, the 24-hour window may also be closed; use `META_REMINDER_TEMPLATE`. Confirm `/health` is up at the time the reminder is due.

**Console mode on a public URL.** Switch `WHATSAPP_PROVIDER` to `meta` or `twilio` before anyone else can open the site.
