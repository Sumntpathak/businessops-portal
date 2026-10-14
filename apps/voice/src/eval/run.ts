/**
 * Prompt/tool evaluation harness. Plays scripted caller conversations against a live
 * Azure realtime deployment in TEXT mode (no audio) using the production prompt and
 * tool definitions, with canned tool results, then scores brevity, tool discipline, etc.
 *
 *   EVAL_ENV_FILE=../../_recepto-voice.env EVAL_AGENT_MD=path/to/agent.md \
 *     node --import tsx src/eval/run.ts [--only "price"] [--effort low] [--model gpt-realtime-2.1-mini] [--verbose]
 */
import fs from "node:fs";
import { WebSocket } from "ws";
import { parseBusinessInfo } from "@recepto/shared";
import { buildInstructions, greetingInstruction, realtimeAuthHeaders, REALTIME_TOOLS, toolLanguageNote } from "../azure-realtime-bridge.js";
import type { CallSession } from "../call-session.js";
import { isRefusal } from "../caller-intent.js";
import { confirmCaller } from "../caller-identity.js";
import { isServiceOffer, ladderNote, ladderStepAfterTool, NO_MORE_OFFERS_NOTE, STOP_OFFERING_NOTE, type LadderStep } from "../call-ladder.js";
import { SCENARIOS, type Scenario, type TurnResult } from "./scenarios.js";

function loadEnvFile(file: string | undefined): void {
  if (!file) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    const key = m?.[1];
    if (m && key && !(key in process.env)) process.env[key] = (m[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(process.env.EVAL_ENV_FILE);

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const MODEL = arg("--model") ?? "gpt-realtime-mini";
const EFFORT = arg("--effort") ?? "none";
const ONLY = arg("--only");
const VERBOSE = process.argv.includes("--verbose");
const GREETING_RUNS = Number(arg("--greeting") ?? 0);
// Caller on an Indian number (the bridge then sees an India-based English speaker).
const INDIA = process.argv.includes("--india");

const url = new URL(process.env.REALTIME_URL ?? process.env.AZURE_REALTIME_URL ?? "");
url.protocol = "wss:";
url.searchParams.set("model", MODEL);
const apiKey = process.env.REALTIME_API_KEY ?? process.env.AZURE_REALTIME_KEY ?? "";
if (!url.hostname || !apiKey) throw new Error("REALTIME_URL / REALTIME_API_KEY (or the AZURE_ names) not set");

const agentMd = process.env.EVAL_AGENT_MD
  ? fs.readFileSync(process.env.EVAL_AGENT_MD, "utf8")
  // The same text the tenant pastes into the dashboard's "More about the business".
  : fs.readFileSync(new URL("../../knowledge/holistic-migration.md", import.meta.url), "utf8");

const defaultHolisticInfo = parseBusinessInfo({
  receptionistName: "Riya",
  receptionistGender: "female",
  about: "Holistic Migration Solutions is an Australian migration advisory practice with 15+ years experience. MARA registered, led by Gagandeep Singh.",
  email: "enquiry@holisticgroup.com.au",
  website: "https://holisticmigrationsolutions.com.au/",
  offices: [
    { name: "Carnegie, VIC", address: "Level 1, 23 Koornang Road, Carnegie VIC 3163", phone: "+61 3 9999 7994", notes: "" },
    { name: "Point Cook, VIC", address: "29/22-30 Wallace Ave, Point Cook VIC 3030", phone: "+61 3 9999 7994", notes: "" },
    { name: "Adelaide, SA", address: "Level 8, 115 King William Street, Adelaide SA 5000", phone: "+61 8 7078 9389", notes: "" }
  ],
  faqs: [
    { question: "Do you guarantee visa approval?", answer: "No one can guarantee a visa outcome; our team prepares the strongest possible compliant application." },
    { question: "How much is an initial consultation?", answer: "An initial consultation is 110 dollars for up to 45 minutes of detailed case assessment." },
    { question: "Can consultations be held remotely?", answer: "Yes, consultations are available via phone, video call, or in person at our offices." }
  ],
  outOfScope: "binding legal advice, guaranteed visa outcomes, medical or financial advice"
});

const session: CallSession = {
  callId: "eval-call",
  providerCallSid: "CAeval",
  tenantId: "eval-tenant",
  timezone: "Australia/Melbourne",
  caller: INDIA
    ? { id: "eval-caller", phoneE164: "+919876543210", displayName: null, country: "India", timezone: "Asia/Kolkata", profile: {}, stage: "new" }
    : { id: "eval-caller", phoneE164: "+61400000002", displayName: null, country: "Australia", timezone: "Australia/Melbourne", profile: {}, stage: "new" },
  intakeFields: [],
  agent: {
    agentMd,
    voiceGreeting: "Thanks for calling Holistic Migration Solutions, this is Riya — how can I help you today?",
    languageMode: "english",
    languages: ["English", "Hindi", "Punjabi"],
    businessInfo: process.env.EVAL_BUSINESS_INFO
      ? parseBusinessInfo(JSON.parse(fs.readFileSync(process.env.EVAL_BUSINESS_INFO, "utf8")))
      : defaultHolisticInfo
  },
  services: [
    { name: "Corporate / Skilled Migration Consultation", durationMinutes: 45, price: "110.00" },
    { name: "General Advisory Consultation", durationMinutes: 30, price: "110.00" },
    { name: "Individual / Family Migration Consultation", durationMinutes: 45, price: "110.00" },
    { name: "Student Services Consultation", durationMinutes: 30, price: "110.00" }
  ],
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00:00", closes: "17:00:00", closed: weekday === 0 || weekday === 6 })),
  transferAvailable: true,
  transferRoster: [{ name: "Gundeep Malhotra", handles: "visa consultations" }],
  memories: [],
  history: { upcomingBookings: [], pendingCallbacks: [], lastCallAt: null },
  startedAt: new Date().toISOString()
};

const SLOT = (start: string, local: string) => ({ startsAt: start, endsAt: start, callerLocalTime: local, businessLocalTime: local });
const TOOL_RESULTS: Record<string, unknown> = {
  check_availability: { serviceId: "svc-student", serviceName: "Student Services Consultation", staffId: null, callerTimezone: "Australia/Melbourne", slots: [SLOT("2026-10-02T00:30:00.000+00:00", "Oct 2, 2026, 10:30 AM"), SLOT("2026-10-02T01:15:00.000+00:00", "Oct 2, 2026, 11:15 AM")] },
  create_booking: { bookingId: "b-1", startsAt: "2026-10-02T00:30:00.000+00:00", callerLocalTime: "Oct 2, 2026, 10:30 AM", businessLocalTime: "Oct 2, 2026, 10:30 AM", serviceName: "Student Services Consultation", staffId: null, tellCaller: "Our team will be in touch to confirm the booking and payment." },
  request_callback: { callbackRequestId: "cb-1", recorded: true },
  end_call: { ended: true }
};

/** Mirrors the bridge: refuse unknown names before the agent promises a transfer. */
function toolResult(name: string, rawArgs: string): unknown {
  if (name === "transfer_to_staff") {
    const args = (() => { try { return JSON.parse(rawArgs) as { staffName?: string; callerWords?: string }; } catch { return {}; } })();
    if (isRefusal(String(args.callerWords ?? ""))) {
      return { transferring: false, reason: `the caller said no ("${args.callerWords}")`, instruction: "Do not connect anyone and do not say you are connecting. Say no problem in one short line and ask how else you can help. Do not offer a transfer again unless the caller asks." };
    }
    const staffName = String(args.staffName ?? "");
    if (staffName && !/gundeep|malhotra/i.test(staffName)) {
      return { transferring: false, reason: `there is no team member matching "${staffName}" who can take a call`, teamMembersYouCanOffer: ["Gundeep Malhotra"], instruction: "Do not say you are connecting anyone. In one short sentence say you cannot connect them to that person, then offer one of teamMembersYouCanOffer by name, or a message for the team." };
    }
    return { transferring: true };
  }
  if (name === "check_availability") {
    // Mirrors the tool: slots for the service the agent asked about, not a fixed one.
    const args = (() => { try { return JSON.parse(rawArgs) as { serviceName?: string }; } catch { return {}; } })();
    const canned = TOOL_RESULTS.check_availability as Record<string, unknown>;
    return {
      ...canned,
      serviceName: args.serviceName || canned.serviceName,
      tellCaller: "Offer one or two of these times in callerLocalTime. Don't mention the price now; it goes in the read-back."
    };
  }
  if (name === "update_caller_profile") {
    // Mirrors the repository: every key the model sends comes back as saved.
    const args = (() => { try { return JSON.parse(rawArgs) as { fields?: Record<string, unknown> }; } catch { return {}; } })();
    return { updated: Object.keys(args.fields ?? {}), rejected: [], profile: {} };
  }
  return TOOL_RESULTS[name] ?? { ok: true };
}

type Item = Record<string, unknown>;

/** The shared eval session with this scenario's caller (name, history, memories) laid over it. */
function sessionFor(scenario: Scenario): CallSession {
  const overrides = scenario.session ?? {};
  return { ...session, ...overrides, caller: { ...session.caller, ...overrides.caller } };
}

/** What the caller hears first: the greeting, plus the bridge's name check for a known caller. */
function spokenGreeting(callSession: CallSession): string {
  const name = callSession.caller.displayName;
  return name ? `${callSession.agent.voiceGreeting} Am I speaking with ${name}?` : callSession.agent.voiceGreeting;
}

function runScenario(scenario: Scenario): Promise<TurnResult[]> {
  const session = sessionFor(scenario);
  const canTransfer = (session.transferRoster?.length ?? 0) > 0 && session.transferAvailable !== false;
  let ladderStep: LadderStep = 1;
  let offerMade = false;
  let identity: "unknown" | "confirmed" | "someone-else" = "unknown";
  /** Mirrors the bridge: confirm_caller and the save gate on a number with a name on file. */
  const scenarioToolResult = (name: string, rawArgs: string): unknown => {
    const args = (() => { try { return JSON.parse(rawArgs) as Record<string, unknown>; } catch { return {}; } })();
    if (name === "confirm_caller") {
      const result = identity === "confirmed"
        ? { confirmed: true, instruction: "Already confirmed earlier in this call; use what you were given then." }
        : identity === "someone-else"
          ? { confirmed: false, reason: "earlier in this call they said they are someone else", instruction: "Keep treating them as a new caller." }
          : confirmCaller(session, String(args.callerWords ?? ""), session.caller.timezone ?? session.timezone);
      if (identity === "unknown") {
        if (result.confirmed) identity = "confirmed";
        else if ("answer" in result && result.answer === "someone-else") identity = "someone-else";
      }
      return result;
    }
    if (name === "update_caller_profile" && session.caller.displayName && identity !== "confirmed") {
      return { saved: false, reason: "caller identity not confirmed", instruction: identity === "someone-else" ? "Don't save anything for this caller." : "If they confirmed who they are, call confirm_caller first." };
    }
    return toolResult(name, rawArgs);
  };
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url.toString(), { headers: realtimeAuthHeaders(url, apiKey) });
    const turns: TurnResult[] = [];
    let turnIndex = 0;
    let current: TurnResult = { caller: "", messages: [], tools: [] };
    let rounds = 0;
    let rateLimitRetries = 0;
    let goodbyeThenEnd = false;
    const timer = setTimeout(() => { ws.close(); reject(new Error(`timeout in "${scenario.name}"`)); }, 240_000);

    const send = (event: Record<string, unknown>) => ws.send(JSON.stringify(event));
    const nextCallerTurn = () => {
      if (turnIndex >= scenario.caller.length) { clearTimeout(timer); ws.close(); resolve(turns); return; }
      current = { caller: scenario.caller[turnIndex++]!, messages: [], tools: [], toolArgs: [] };
      rounds = 0;
      send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: current.caller }] } });
      // Mirrors the bridge: the first answer to "Am I speaking with X?" settles who is calling.
      if (turnIndex === 1 && session.caller.displayName && identity === "unknown") {
        const name = session.caller.displayName;
        const result = confirmCaller(session, current.caller, session.caller.timezone ?? session.timezone);
        const note = result.confirmed
          ? [`The caller confirmed they are ${name}. Don't ask their name and don't call confirm_caller. ${result.instruction}`, ...result.history].join("\n")
          : result.answer === "someone-else" ? `The person on the line is not ${name}. ${result.instruction}` : null;
        if (result.confirmed) identity = "confirmed";
        else if (result.answer === "someone-else") identity = "someone-else";
        if (note) send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: note }] } });
      }
      send({ type: "response.create" });
    };

    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
    ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString()) as { type: string; response?: { status?: string; output?: Item[] }; error?: { message?: string } };
      if (process.env.EVAL_DEBUG) console.log(`   [${scenario.name.slice(0, 18)}] ${e.type}${e.response?.status ? " " + e.response.status : ""}`);
      if (e.type === "session.created") {
        send({
          type: "session.update",
          session: { type: "realtime", output_modalities: ["text"], instructions: buildInstructions(session), tools: REALTIME_TOOLS, tool_choice: "auto", ...(EFFORT === "none" ? {} : { reasoning: { effort: EFFORT } }) }
        });
      } else if (e.type === "session.updated") {
        send({ type: "conversation.item.create", item: { type: "message", role: "assistant", content: [{ type: "output_text", text: spokenGreeting(session) }] } });
        nextCallerTurn();
      } else if (e.type === "error") {
        clearTimeout(timer); ws.close(); reject(new Error(e.error?.message ?? "realtime error"));
      } else if (e.type === "response.done") {
        const output = e.response?.output ?? [];
        if (output.length === 0) {
          const detail = JSON.stringify((e.response as { status_details?: unknown } | undefined)?.status_details ?? null);
          // The deployment's tokens-per-minute quota can be exhausted by parallel eval sessions: wait and retry
          // the same response instead of scoring an empty reply as the agent's behaviour.
          if (/rate_limit/.test(detail) && ++rateLimitRetries <= 8) {
            setTimeout(() => send({ type: "response.create" }), 4000);
            return;
          }
          console.log(`   [${scenario.name.slice(0, 24)}] EMPTY response status=${e.response?.status} details=${detail.slice(0, 200)}`);
        }
        for (const item of output) {
          if (item.type === "message") {
            const text = ((item.content as Item[]) ?? []).map((c) => String(c.text ?? c.transcript ?? "")).join("").trim();
            if (text) current.messages.push(text);
            // Mirrors the bridge: after the first consultation/callback offer, no more pitching.
            if (text && isServiceOffer(text)) {
              send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: offerMade ? STOP_OFFERING_NOTE : NO_MORE_OFFERS_NOTE }] } });
              offerMade = true;
            }
          }
        }
        if (goodbyeThenEnd) { turns.push(current); clearTimeout(timer); ws.close(); resolve(turns); return; }
        const calls = output.filter((i) => i.type === "function_call");
        if (calls.length === 0 || ++rounds > 6) { turns.push(current); nextCallerTurn(); return; }
        // The live bridge sends no follow-up response after a transfer or end_call, so the call is over here too.
        const results = calls.map((call) => ({ call, name: String(call.name), result: scenarioToolResult(String(call.name), String(call.arguments ?? "{}")) }));
        for (const { name, call } of results) {
          current.tools.push(name);
          current.toolArgs?.push((() => { try { return JSON.parse(String(call.arguments ?? "{}")) as Record<string, unknown>; } catch { return {}; } })());
        }
        const spoke = output.some((item) => item.type === "message");
        if (results.some(({ name }) => name === "end_call") && !spoke) {
          // Mirrors the bridge: a silent end_call gets one spoken goodbye before hanging up.
          goodbyeThenEnd = true;
          send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: "Say one short goodbye now, in the caller's language. Do not call any tool." }] } });
          send({ type: "response.create", response: { tool_choice: "none" } });
          return;
        }
        if (results.some(({ name, result }) => name === "end_call" || (name === "transfer_to_staff" && (result as { transferring?: boolean }).transferring))) {
          turns.push(current);
          clearTimeout(timer); ws.close(); resolve(turns);
          return;
        }
        for (const { call, name, result } of results) {
          send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) } });
          // Mirrors the bridge: a one-line "Call progress" note each time the call reaches a new step.
          const next = ladderStepAfterTool(ladderStep, name, result);
          const note = next === ladderStep || (next === 3 && offerMade) ? null : ladderNote(next, canTransfer);
          ladderStep = next;
          if (note) send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: note }] } });
        }
        if (session.agent.languages.length > 1) {
          const reported = (() => { try { return (JSON.parse(String(calls.at(-1)?.arguments ?? "{}")) as { callerLanguage?: unknown }).callerLanguage; } catch { return undefined; } })();
          send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: toolLanguageNote(reported) }] } });
        }
        // Mirrors the bridge: a detail saved while the agent was already talking gets no second reply.
        if (spoke && results.every(({ name }) => name === "update_caller_profile")) { turns.push(current); nextCallerTurn(); return; }
        send({ type: "response.create" });
      }
    });
  });
}

/** Opens a session and asks for ONLY the greeting, to count how many messages the model speaks. */
function runGreeting(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url.toString(), { headers: realtimeAuthHeaders(url, apiKey) });
    const timer = setTimeout(() => { ws.close(); reject(new Error("greeting timeout")); }, 120_000);
    let retries = 0;
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
    ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString()) as { type: string; response?: { status_details?: unknown; output?: Item[] }; error?: { message?: string } };
      if (e.type === "session.created") {
        ws.send(JSON.stringify({ type: "session.update", session: { type: "realtime", output_modalities: ["text"], instructions: buildInstructions(session), tools: REALTIME_TOOLS, tool_choice: "auto", ...(EFFORT === "none" ? {} : { reasoning: { effort: EFFORT } }) } }));
      } else if (e.type === "session.updated") {
        ws.send(JSON.stringify({ type: "response.create", response: { instructions: greetingInstruction(session.agent.voiceGreeting) } }));
      } else if (e.type === "response.done") {
        const output = e.response?.output ?? [];
        if (output.length === 0 && /rate_limit/.test(JSON.stringify(e.response?.status_details ?? "")) && ++retries <= 8) {
          setTimeout(() => ws.send(JSON.stringify({ type: "response.create", response: { instructions: greetingInstruction(session.agent.voiceGreeting) } })), 4000);
          return;
        }
        clearTimeout(timer); ws.close();
        resolve(output.filter((i) => i.type === "message").map((i) => ((i.content as Item[]) ?? []).map((c) => String(c.text ?? c.transcript ?? "")).join("").trim()));
      } else if (e.type === "error") { clearTimeout(timer); ws.close(); reject(new Error(e.error?.message ?? "error")); }
    });
  });
}

if (GREETING_RUNS > 0) {
  const counts: number[] = [];
  const samples: string[][] = [];
  for (let i = 0; i < GREETING_RUNS; i += 3) {
    const batch = await Promise.all(Array.from({ length: Math.min(3, GREETING_RUNS - i) }, () => runGreeting().catch(() => [])));
    for (const messages of batch) { counts.push(messages.length); samples.push(messages); }
  }
  const doubled = counts.filter((n) => n > 1).length;
  console.log(`GREETING RUNS: ${counts.length}  | spoken once: ${counts.filter((n) => n === 1).length}  | spoken more than once: ${doubled}  | empty: ${counts.filter((n) => n === 0).length}`);
  for (const m of samples.filter((x) => x.length > 1).slice(0, 3)) console.log("   doubled example:", JSON.stringify(m).slice(0, 220));
  process.exit(doubled === 0 ? 0 : 1);
}

const selected = SCENARIOS.filter((s) => !ONLY || s.name.toLowerCase().includes(ONLY.toLowerCase()));
console.log(`model=${MODEL} effort=${EFFORT} scenarios=${selected.length}\n`);

type Outcome = { scenario: Scenario; turns: TurnResult[]; error: string | null };

/** Runs scenarios with a small concurrency cap; the deployment throttles when many sessions open at once. */
async function runAll(scenarios: Scenario[], concurrency: number): Promise<Outcome[]> {
  const outcomes: Outcome[] = new Array(scenarios.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < scenarios.length; i = next++) {
      const scenario = scenarios[i]!;
      try { outcomes[i] = { scenario, turns: await runScenario(scenario), error: null }; }
      catch (error) { outcomes[i] = { scenario, turns: [], error: error instanceof Error ? error.message : String(error) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, worker));
  return outcomes;
}

const results = await runAll(selected, Number(arg("--concurrency") ?? 3));

let passed = 0;
let total = 0;
let wordsTotal = 0;
let turnsTotal = 0;
for (const { scenario, turns, error } of results) {
  console.log(`━━ ${scenario.name}`);
  if (error) { console.log(`   ERROR: ${error}\n`); total += scenario.checks.length; continue; }
  for (const t of turns) {
    console.log(`   caller: ${t.caller}`);
    if (t.tools.length) console.log(`   tools : ${t.tools.join(", ")}`);
    console.log(`   agent : ${t.messages.join("  ‖  ")}`);
    wordsTotal += t.messages.join(" ").split(/\s+/).filter(Boolean).length;
    turnsTotal += 1;
  }
  for (const check of scenario.checks) {
    total += 1;
    const failure = check.run(turns);
    if (!failure) passed += 1;
    if (failure || VERBOSE) console.log(`   ${failure ? "✗" : "✓"} ${check.name}${failure ? " — " + failure : ""}`);
  }
  console.log("");
}
const msgTotal = results.reduce((acc, r) => acc + r.turns.reduce((x, t) => x + t.messages.length, 0), 0);
console.log(`RESULT: ${passed}/${total} checks passed | avg ${turnsTotal ? (wordsTotal / turnsTotal).toFixed(1) : 0} words per agent turn | ${turnsTotal ? (msgTotal / turnsTotal).toFixed(2) : 0} spoken messages per turn`);
process.exit(passed === total ? 0 : 1);
