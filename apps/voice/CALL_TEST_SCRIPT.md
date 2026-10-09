# Riya call test script (about 3 minutes)

Call the receptionist line from your Indian mobile and say each line in order. Wait for Riya to finish before the next line. Tick ✅ or ❌ in the last column.

The same conversation runs automatically against the live model:
`EVAL_ENV_FILE=../../_recepto-voice.env npx tsx src/eval/run.ts --india --only "full 3-minute"` (from `apps/voice`).

## Call 1: the full receptionist

| # | You say | Riya should | What it tests | ✅/❌ |
|---|---------|-------------|---------------|------|
| 1 | हाँ, मैं सुमंत बोल रहा हूँ। | Greet you by name, in Hindi | Name confirmation, Hindi | |
| 2 | आप कैसी हो? | "मैं ठीक हूँ, शुक्रिया! आप कैसे हैं?" | Small talk like a person | |
| 3 | आप लोग क्या काम करते हो? | Describe the services briefly, in Hindi | Business facts | |
| 4 | आपका ऑफिस कहाँ है और टाइमिंग क्या है? | Office locations, and hours in **India time** (not "9 to 5") | Office hours for an Indian caller | |
| 5 | Consultation ki fees kitni hai? | "110 dollars" | Price | |
| 6 | क्या मेरा स्टूडेंट वीज़ा अप्रूव हो जाएगा? | Politely decline to advise, offer a callback | No advice rule | |
| 7 | नहीं, अभी मैसेज नहीं चाहिए। | Accept it, **no callback recorded** | Respects a no | |
| 8 | Can I speak to Ramlal? | In **English**: nobody called Ramlal, offers Gundeep | Unknown person, language switch | |
| 9 | Not now. | **No transfer**, asks how else to help | "Not now" is a no | |
| 10 | I want to book a student services consultation, any day next week is fine. | Offers one or two times in **your** time, with the price | Availability | |
| 11 | The first one works. | Reads it back and asks "Shall I book it?". **Does not book yet** | Confirmation before booking | |
| 12 | Yes, book it. My name is Sumant. | Confirms the booking once | Booking | |
| 13 | ਇੱਕ ਗੱਲ ਹੋਰ, ਆਸਟ੍ਰੇਲੀਆ ਵਿੱਚ ਅੱਜ ਮੌਸਮ ਕਿਵੇਂ ਹੈ? | Answers in **Punjabi**, says she doesn't have that information | Punjabi, out of scope | |
| 14 | Please ask Gundeep to call me back tomorrow evening about my documents. | Confirms the callback, in English | Callback | |
| 15 | Bas itna hi, thank you, bye. | Says goodbye **out loud**, then hangs up | Ending the call | |

Throughout: replies short (one or two sentences), no fillers like "take your time", and Riya waits for you to finish (about a 1 second pause) before speaking.

## Call 2: transfer (30 seconds)

| # | You say | Riya should | ✅/❌ |
|---|---------|-------------|------|
| 1 | मुझे किसी कंसल्टेंट से बात करनी है। | "I'll connect you with Gundeep Malhotra now, please stay on the line" (in Hindi), then the call rings Gundeep | |

## Call 3: agent.md coverage + the bugs fixed this round (about 4 minutes)

Covers every fact in `apps/voice/agent.md` plus the specific bugs the tester reported (transfer refusal, language stuck, team vs. transfer roster, wrong slot booked).

| # | You say | Riya should | What it tests | ✅/❌ |
|---|---------|-------------|---------------|------|
| 1 | Who is the director of the business? | Gagandeep Singh | Public fact, always answerable | |
| 2 | Are you MARA registered? | Yes, MARA registered | Accreditation fact | |
| 3 | Who are the team members working there? | Answers from the business facts (Gagandeep Singh + team), not only "Gundeep Malhotra, no one else" | Team vs. transfer-roster mixup (fixed) | |
| 4 | What's a 485 visa? | Temporary Graduate Visa, short explanation | General visa info, no advice | |
| 5 | Will my skilled visa definitely get approved? | Declines to guarantee, no promise | No-guarantee policy | |
| 6 | What documents do I need to prepare? | Passport, visa grant notice, resume, education/employment records | Documents list fact | |
| 7 | आपका पॉइंट कुक ऑफिस कहाँ है? | Point Cook address, **in Hindi** | Office fact, Hindi | |
| 8 | ਤੁਹਾਡੀ ਫੀਸ ਕਿੰਨੀ ਹੈ? | 110 dollars, **switches to Punjabi in the same reply**, does not stay in Hindi | Mid-call language switch (fixed) | |
| 9 | ਹੁਣੇ ਕਿਸੇ ਨਾਲ ਜੋੜ ਦਿਓ। (connect me now) | Connects right away (or explains nobody's available + offers callback) — never a flat refusal | Transfer-refusal inversion (fixed) | |
| 10 | I'd like to book a student services consultation for tomorrow. | Offers one or two times with price | Availability | |
| 11 | I'll take the 10 AM one. | Reads back the **exact** time offered near 10, confirms before booking | Exact-slot booking accuracy (fixed) | |
| 12 | Yes, book it, my name is Sumant. | Books that exact same time — not a different slot | Booking matches what was confirmed | |
| 13 | What's your consultation fee, does it include GST? | States 110 dollars; known gap — may invent a GST answer, flag if so | Known pre-existing gap, not yet fixed | |

## After the calls

Check the dashboard: one booking for Sumant, one callback request ("documents", tomorrow evening), and no callback from step 7 (Call 1). For Call 3, confirm the booking time in the dashboard matches what you said in step 11/12, not a different slot.
