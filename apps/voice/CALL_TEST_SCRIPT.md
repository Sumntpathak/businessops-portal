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

## After the calls

Check the dashboard: one booking for Sumant, one callback request ("documents", tomorrow evening), and no callback from step 7.
