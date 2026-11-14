# Bridgeline: Devpost submission text

**Pathway:** Hackathon
**Tagline:** School notices, made clear, in your family's language.

## The problem
Every week, schools send families flyers, permission slips, fee reminders and policy emails, usually in dense English. For families who speak another language, have limited literacy, or are juggling work and kids, these notices are easy to misread or miss. The result is missed deadlines, unclaimed lunch benefits, skipped conferences, and students left out of field trips. Plain translation tools exist, but they translate words without telling a parent what to do, by when, or how to answer.

## Our solution
Bridgeline turns any school notice into action. A parent pastes text or snaps a photo, and gets in seconds:
1. A **plain-language summary** at a chosen reading level, in one of 26 languages
2. A **checklist of actions with deadlines**, plus dates, costs, things to bring, and who to contact
3. **One-tap calendar reminders** (.ics and Google Calendar)
4. **Read-aloud audio** for low-literacy users, and **voice input** for replies and questions
5. A **reply helper** that writes a polite English message from the parent's own words, with a back-translation to check it
6. **Ask-the-notice Q&A** that answers only from the notice and shows the exact sentence
7. A **teacher view** that simplifies and translates messages before they go out

## What makes it different
- **Translation that costs nothing:** works with no key, no account and no server, using the device's own translator when available and a free service otherwise, with private details masked first
- **Built for the people who need it most:** Easy mode, read-aloud, voice input, an easy-reading font, share by WhatsApp or SMS
- **Both sides of the problem:** families get clarity, and schools get a Clarity Score, templates, a text-message version and a printable multilingual flyer, so notices are better before they are even sent
- **Honest by design:** original beside summary, machine-translation labels, "double-check with the school" prompts

## How it works
A dependency-free Node.js server and a vanilla-JS progressive web app. The server redacts private details (emails, phone numbers, IDs, names) into reversible tokens, sends the notice to Claude with prompts that treat the notice as untrusted data, validates the reply against a strict schema, and restores the private details. Notices are saved only in the user's browser. If the AI is unavailable, a rule-based offline analyzer keeps the app working.

## STEM connection
Natural language processing and large language models, OCR and computer vision, structured information extraction, readability analysis (Flesch-Kincaid), speech synthesis and recognition, calendar data standards (iCalendar), and privacy engineering.

## Impact and feasibility
- Works for any school at no hardware cost; a teacher can use it the same day
- Direct benefit for English learners, low-literacy and overwhelmed families
- Privacy by design: no database, no accounts
- Honest about limits: original shown beside the summary, uncertainty flagged, "confirm with the school" guidance

## What we built vs. what we used
- **Built by us:** the server, UI, redaction layer, schema validation, offline analyzer, calendar builder, readability scoring, prompts, and tests
- **Used:** Claude (Anthropic) for runtime understanding and translation, and as a coding assistant; Tesseract.js for optional in-browser OCR

## Roadmap
Pilot with one teacher; test with bilingual families; teacher templates; opt-in encrypted push reminders; integration with school messaging systems; human review for high-stakes translations.

## Built with
Node.js, JavaScript, HTML/CSS, Claude API, Tesseract.js, Web Speech API, iCalendar
