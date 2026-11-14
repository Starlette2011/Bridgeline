# Bridgeline

**School notices, made clear — in your family's language.**

Schools send a constant stream of flyers, permission slips, deadlines and policy emails, usually in dense English. Families who speak another language, have limited literacy, or are simply overwhelmed miss deadlines, fee waivers and conference sign-ups, and their kids pay for it.

Bridgeline turns any school notice into a plain-language summary, a checklist of what to do and by when, calendar reminders, read-aloud audio, and a ready-to-send reply, in one of 26 languages. It also has a teacher side that rewrites and translates messages before they go out.

Built for the **STEMergent Hacks 2026** Hackathon Pathway (Social Good · ML/AI · Low/No Code).

**Live demo:** `https://<your-username>.github.io/<repo-name>/` (see "Deploy on GitHub Pages" below)

---

## Run it (pick one)

Bridgeline is a plain static web app. **Everything runs in the browser**, so it works on GitHub Pages, any static host, or straight from your disk. A Node server is optional.

### 1. Deploy on GitHub Pages (recommended, 2 minutes)
1. Push this repo to GitHub (branch `main`).
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The included workflow (`.github/workflows/pages.yml`) runs on the next push, or run it manually from the **Actions** tab. Your app appears at `https://<user>.github.io/<repo>/`.

No GitHub Actions? Drag the `public/` folder onto Netlify Drop, or upload it to any static host. It needs no build step.

### 2. Open it locally with no setup
Double-click `public/index.html`. (Or run `npx serve public`.) Demo mode works instantly.

### 3. Run the optional Node server (Node 18+, zero dependencies)
```bash
cp .env.example .env     # optional: add ANTHROPIC_API_KEY so the server provides AI for everyone
npm start                # http://localhost:3000
```

## Free mode and AI mode

| | **Free mode** (no key, default) | **AI mode** (your own key, or a server key) |
|---|---|---|
| Understanding | Rule-based extraction of dates, times, money, actions, contacts and jargon | Claude reads and reasons about the notice |
| Translation | **Free, 26 languages:** your browser's on-device translator when available, otherwise the free MyMemory service | Natural, context-aware translation by Claude |
| Photos / PDFs | In-browser OCR (Tesseract.js from a CDN, English) | Sent to Claude (vision and PDF reading) |
| Reply / Ask / Teacher | Templates and keyword search, with free translation | Full AI |

**How free translation works.** Bridgeline first tries the browser's built-in Translator API (Chrome 138+): private, offline and unlimited, but only used when that language pair is already installed. Otherwise it sends short pieces of the notice to [MyMemory](https://mymemory.translated.net/), a free service, after masking emails, phone numbers, IDs and any names you list. The free limit is about 5,000 characters a day, or 50,000 if you add an email in **Settings**. Results are cached, a limit or network error is explained clearly, and the English version always stays available. Machine translation can contain mistakes, so every translated notice is labeled and keeps the "double-check with the school" box.

**Turning on AI on a static site:** open **Settings** and paste an [Anthropic API key](https://console.anthropic.com/). The key is stored only in that browser and sent only to `api.anthropic.com`. Use a key with a low spending limit and never on a shared computer. If the key is wrong or the service is down, Bridgeline says why and falls back to free mode.

**Turning on AI for everyone:** run the Node server with `ANTHROPIC_API_KEY` set. The key stays on the server. (Never put a key in the static files; anything in a static site is public.)

---

## Features

**For families**
- **Plain-language summary** at a 3rd, 5th or 8th-grade reading level, in 26 languages, **free with no key**
- **Action checklist** with deadlines, priority and type (sign, pay, RSVP, bring, submit…)
- **Important dates** with times and locations; **money**, **things to bring**, **contacts** (tap to call or email), and a **glossary** of school jargon
- **Calendar export**: per-item `.ics` or Google Calendar links, or everything at once. Reminders are built into the `.ics`
- **Read-aloud** with adjustable speed, using the device's built-in voices
- **Photo, PDF or pasted text** input (camera, upload, drag-and-drop, paste an image)
- **Original beside summary** with dates, times and prices highlighted, so families can verify
- **"Double-check with the school"** panel and a **confidence meter**
- **Reply helper**: write or speak in your own language, get a polite English message plus a **back-translation** to check it. Quick replies for confirm, decline, question, more time, help paying, interpreter
- **Ask about a notice**: answers come only from the notice, with the exact supporting sentence
- **Voice input** for replies and questions
- **My notices**: saved notices, a 14-day agenda, check-off progress, due-soon banner, optional on-device notifications, JSON backup/restore, delete-all
- **Print** a one-page summary
- **Easy mode**: a big, simple view with just the summary, a Listen button and the to-do list, for low-literacy and first-time users
- **Share** a notice or the weekly digest by **WhatsApp, SMS, email** or copy, in the family's language
- **Switch language any time**: a saved notice re-translates, and English is always one tap away

**For schools**
- **Clarity score (0-100)** that updates as you type, with 8 transparent checks (action first, clear date, reading level, sentence length, contact info, jargon, language help, help with costs) and a fix for each
- **8 ready-made templates** (field trip, early release, conferences, picture day, flu clinic, lunch fees, weather closure, attendance) already scoring 90+
- **Message simplifier + translator**: plain English plus up to 8 translations, free or AI
- **Text-message version** (under 300 characters) and a **printable multilingual flyer**
- **Readability meter** (Flesch-Kincaid grade) before and after

**Accessibility**
- Larger/smaller text, high-contrast and dark modes, keyboard-navigable tabs, skip link, screen-reader labels, right-to-left layout for Arabic, Urdu and Persian
- Installable as a PWA; the app shell works offline
- Interface in English, Spanish, Chinese, Vietnamese and Arabic; notices translate into 26 languages
- Typeset in Montserrat, with an **easy-reading font toggle** (Atkinson Hyperlegible, designed for low vision and dyslexia)

**Privacy and safety**
- **No database and no accounts.** Notices live only in the browser's local storage
- **Reversible redaction**: emails, phone numbers, SSN-like numbers, ID numbers and names you list are replaced by tokens like `[EMAIL_1]` before text goes to the AI, then swapped back in the result
- **Prompt-injection defense**: notice text is treated as untrusted data, and the model is told never to follow instructions inside it
- AI output is validated against a strict schema, and the UI builds the page with DOM APIs, not raw HTML
- Server mode adds a strict Content-Security-Policy, rate limiting, size limits and path-traversal protection

---

## How it works

One shared engine (`src/`) runs in both places:

```
              ┌────────────── src/engine.js (shared) ──────────────┐
              │ validate → redact PII → prompt → parse → normalize │
              │ → restore PII  |  offline rules if no AI / on error │
              └───────▲────────────────────────────────▲───────────┘
   npm run build      │                                │  require()
┌─────────────────────┴───────────┐        ┌───────────┴───────────┐
│ public/js/engine.js (bundle)     │        │ server.js (optional)  │
│ runs in the browser: Pages,      │        │ key in env var,       │
│ static hosts, file://            │        │ rate limiting, CSP    │
│ AI = user's key → Anthropic API  │        │ AI = server → Anthropic│
└──────────────────────────────────┘        └───────────────────────┘
```

### Project structure

```
public/                 The whole app (this folder is what GitHub Pages publishes)
  index.html, styles.css, app.js
  js/engine.js          Browser bundle of src/ (generated; `npm run build`)
  js/translate.js       Free translation (on-device Translator API, then MyMemory)
  js/ics.js, samples.js, templates.js, i18n.js, i18n-labels.js
  sw.js, manifest.webmanifest, icon.svg
src/                    Shared engine: engine, prompts, schema, redact, heuristic, demo, clarity, readability, languages, json, llm
server.js               Optional Node server (static files + /api, no dependencies)
scripts/build-engine.js Bundles src/ into public/js/engine.js
test/                   node:test suites
docs/                   Devpost text and demo script
```

**If you change anything in `src/`, run `npm run build` and commit `public/js/engine.js`.** `npm test` fails if the bundle is out of date.

### Server API (only when you run `server.js`)

| Route | Body | Returns |
|---|---|---|
| `GET /api/health` | – | `{ ok, mode, model }` |
| `POST /api/analyze` | `{ text?, file?: {mediaType, data}, language, level, today, redact, hideNames }` | `{ mode, analysis, source_text }` |
| `POST /api/reply` | `{ parentText, intent, language, notice? }` | `{ reply: {subject, message_en, back_translation, notes} }` |
| `POST /api/ask` | `{ question, noticeText, language, level, history? }` | `{ answer, quote, found }` |
| `POST /api/compose` | `{ message, languages[], level }` | `{ subject, plain_english, translations[], tips[] }` |

Server settings (`.env`): `ANTHROPIC_API_KEY`, `BRIDGELINE_MODEL` (default `claude-sonnet-5-5`), `PORT`, `RATE_LIMIT_PER_MIN`, `TRUST_PROXY=1` behind a proxy, `BRIDGELINE_FORCE_DEMO=1`. Docker: `docker build -t bridgeline . && docker run -p 3000:3000 -e ANTHROPIC_API_KEY=... bridgeline`.

---

## Tests

```bash
npm test
```

37 tests with Node's built-in runner. They cover PII redaction round-trips, schema normalization of malformed AI output, date/time parsing, the offline analyzer, `.ics` generation, readability scoring, the HTTP server, **the browser bundle running in a bare sandbox**, the free translation layer (privacy masking, on-device-first, timeouts, quota errors, caching), the clarity score, and `test/ai.test.js`, which runs the real AI code path against a local mock of the Anthropic API (no key needed). It checks that private details never reach the provider and are restored afterwards, that photos and PDFs are forwarded correctly, and that an outage or bad key falls back to offline mode with a reason.

The mocks do not test the quality of real model output, so try AI mode with a few real, anonymized notices before relying on it.

## Limitations

- **AI translation can be wrong.** Bridgeline shows the original beside the summary, lists what it is unsure about, and tells families to confirm important details with the school. It is a communication aid, not an official or legal translation.
- Photos and PDFs go to the AI as they are; redaction only applies to pasted text.
- Reminders are `.ics` calendar alerts, or shown when the app is opened. Background push would need a server-side store, which we avoid for privacy.
- Free translation depends on MyMemory's daily limit and on the device; quality is below AI translation, especially for rarer languages. The free-translation code is covered by automated tests with mocks, but the real MyMemory service was not reachable from the build environment, so test it once on your own connection.
- Demo-mode OCR loads Tesseract.js from a CDN (needs internet) and reads English only.
- Speech voices depend on the device; some languages may have no installed voice.

## Roadmap
Pilot with one school and bilingual families; teacher templates and a school-wide dashboard; opt-in encrypted push reminders; school messaging integrations; human review for high-stakes translations.

## AI and third-party disclosure
- **Claude (Anthropic)** is used at runtime for understanding and translating notices, and was used as a coding assistant while building this project.
- **Tesseract.js** (Apache-2.0) provides optional in-browser OCR in free mode.
- **MyMemory** (free translation API) and the browser's built-in **Translator API** provide key-free translation.
- **Montserrat** and **Atkinson Hyperlegible** from Google Fonts (SIL Open Font License) are the typefaces; system fonts are used if it can't load.
- Everything else is plain Node.js and browser JavaScript with no third-party packages. All sample notices are fictional.

## License
MIT. See [LICENSE](LICENSE).
