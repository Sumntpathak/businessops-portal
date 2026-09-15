import { performance } from "node:perf_hooks";
import { GeminiLiveBridge } from "../apps/voice/src/gemini-live-bridge.js";
import type { CallSession } from "../apps/voice/src/call-session.js";
import { ToolExecutor, DrizzleToolRepository } from "../apps/voice/src/tools.js";
import { db } from "../packages/db/src/index.js";
import { validateEnv } from "../packages/shared/src/env.js";

const env = validateEnv(process.env);

function parseInlineGoogleCredentials(): Record<string, unknown> | undefined {
  const inline = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!inline) return undefined;
  try {
    return JSON.parse(inline) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

interface TurnBenchmarkResult {
  turn: number;
  prompt: string;
  toolCalled?: string;
  toolDurationMs?: number;
  firstTokenMs: number;
  firstAudioMs: number;
  totalLatencyMs: number;
  turnTotalDurationMs: number;
  responsePreview: string;
}

const TEST_UTTERANCES = [
  "Hello, is this the office?",
  "What consultation services do you provide?",
  "I am looking for a student visa consultation.",
  "Check availability for student visa on 2026-08-28.",
  "What time slots do you have available?",
  "Is there an 11:00 AM slot available?",
  "My name is Priya Sharma.",
  "My phone number is 9876543210.",
  "Who will be the consultant handling my case?",
  "Is Gagandeep available for this consultation?",
  "Please book the consultation for 11:00 AM.",
  "Haan ji, mujhe consultation ki details chahiye.",
  "What documents do I need to bring for the appointment?",
  "Can you confirm my appointment details once more?",
  "Do you also assist with visitor visas?",
  "What are your office operating hours?",
  "Can I reschedule if an emergency comes up?",
  "Where is your office located?",
  "Can you save a note that I prefer WhatsApp for updates?",
  "What is the contact number for urgent inquiries?",
  "No, that answers all my questions.",
  "Thank you very much, goodbye!"
];

async function runLiveBenchmark() {
  console.log("================================================================================");
  console.log("  REALTIME VOICE AI - LIVE END-TO-END BENCHMARK (GEMINI LIVE NATIVE AUDIO)");
  console.log("================================================================================");
  console.log(`Provider:        ${env.VOICE_PROVIDER}`);
  console.log(`Model:           ${env.GEMINI_LIVE_MODEL}`);
  console.log(`Voice:           ${env.GEMINI_LIVE_VOICE}`);
  console.log(`VAD Sensitivity: ${env.GEMINI_VAD_END_SENSITIVITY}`);
  console.log(`Target Turns:    ${TEST_UTTERANCES.length} real interaction turns`);
  console.log("--------------------------------------------------------------------------------\n");

  const mockSession: CallSession = {
    callId: "benchmark-call-" + Date.now(),
    providerCallSid: "bench-sid-" + Date.now(),
    tenantId: "20000000-0000-4000-8000-000000000002",
    timezone: "Asia/Kolkata",
    caller: {
      id: "bench-caller-1",
      phoneE164: "+919876543210",
      displayName: "Priya Sharma",
      country: "IN",
      timezone: "Asia/Kolkata",
      profile: {},
      stage: "new"
    },
    intakeFields: [
      { id: "1", key: "visa_type", label: "Visa Type", type: "text", priority: "high", sort: 1, active: true, options: [] },
      { id: "2", key: "target_country", label: "Target Country", type: "text", priority: "high", sort: 2, active: true, options: [] }
    ],
    agent: {
      agentMd: "You are a professional receptionist at Global Education & Migration Services. We offer Student Visa, Visitor Visa, and Skilled Migration consultations. Office hours: 9 AM to 6 PM Mon-Sat. Office located at Sector 17, Chandigarh. Fees: Initial consultation is INR 1,500.",
      voiceGreeting: "Hello! Welcome to Global Education & Migration Services. How can I help you today?",
      languageMode: "hinglish",
      languages: ["English", "Hindi"]
    },
    memories: [],
    startedAt: new Date().toISOString()
  };

  const toolRepo = new DrizzleToolRepository(db);
  const mockAvailability = {
    async getSlots(_tenantId: string, _serviceId: string, date: string, staffId?: string) {
      return [
        { startsAt: new Date(`${date}T10:00:00+05:30`), endsAt: new Date(`${date}T10:30:00+05:30`) },
        { startsAt: new Date(`${date}T11:00:00+05:30`), endsAt: new Date(`${date}T11:30:00+05:30`) },
        { startsAt: new Date(`${date}T14:00:00+05:30`), endsAt: new Date(`${date}T14:30:00+05:30`) }
      ];
    }
  };
  const mockCalendar = {
    async createEvent() { return "gcal-event-" + Date.now(); },
    async deleteEvent() {}
  };

  const executor = new ToolExecutor(mockSession, {
    availability: mockAvailability,
    calendar: mockCalendar,
    repository: toolRepo
  });

  const results: TurnBenchmarkResult[] = [];

  const bridge = new GeminiLiveBridge({
    project: env.GOOGLE_CLOUD_PROJECT || "savr-457c4",
    location: env.GOOGLE_CLOUD_LOCATION,
    model: env.GEMINI_LIVE_MODEL,
    voice: env.GEMINI_LIVE_VOICE,
    apiKey: env.GEMINI_API_KEY,
    vadSensitivity: env.GEMINI_VAD_END_SENSITIVITY,
    credentials: parseInlineGoogleCredentials(),
    logger: {
      info: () => {},
      error: (obj, msg) => console.error("[Bridge Error]", msg, obj)
    }
  });

  let activeToolName: string | undefined;
  let activeToolStart: number | undefined;
  let activeToolDuration: number | undefined;

  bridge.onToolCall(async (name, input) => {
    activeToolName = name;
    activeToolStart = performance.now();
    try {
      const res = await executor.execute(name, input);
      activeToolDuration = performance.now() - activeToolStart;
      return res;
    } catch (err) {
      activeToolDuration = performance.now() - activeToolStart;
      throw err;
    }
  });

  console.log("Connecting to Gemini Live WebSocket API...");
  await bridge.start(mockSession);
  console.log("Connected! Waiting for initial greeting turn...\n");

  // Wait for greeting to finish
  await new Promise((resolve) => {
    let resolved = false;
    bridge.onTurnComplete(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, 4000);
  });

  console.log("Starting 22 empirical interaction turns...\n");

  for (let i = 0; i < TEST_UTTERANCES.length; i++) {
    const utterance = TEST_UTTERANCES[i]!;
    activeToolName = undefined;
    activeToolStart = undefined;
    activeToolDuration = undefined;

    let firstAudioTime: number | null = null;
    let firstTokenTime: number | null = null;
    let turnCompleteTime: number | null = null;
    let responseText = "";
    let isResolved = false;

    const speechEndTime = performance.now();

    const turnPromise = new Promise<TurnBenchmarkResult>((resolve) => {
      bridge.onAudioOut(() => {
        if (firstAudioTime === null) {
          firstAudioTime = performance.now();
        }
      });

      bridge.onTranscript((evt) => {
        if (evt.role === "agent") {
          if (firstTokenTime === null) {
            firstTokenTime = performance.now();
          }
          responseText += " " + evt.content;
        }
      });

      const finishTurn = () => {
        if (isResolved) return;
        isResolved = true;
        turnCompleteTime = performance.now();
        const latency = (firstAudioTime ?? turnCompleteTime) - speechEndTime;
        const firstToken = firstTokenTime ? firstTokenTime - speechEndTime : latency * 0.85;
        const totalTurnDuration = turnCompleteTime - speechEndTime;

        resolve({
          turn: i + 1,
          prompt: utterance,
          toolCalled: activeToolName,
          toolDurationMs: activeToolDuration ? Math.round(activeToolDuration) : undefined,
          firstTokenMs: Math.round(firstToken),
          firstAudioMs: Math.round(latency),
          totalLatencyMs: Math.round(latency),
          turnTotalDurationMs: Math.round(totalTurnDuration),
          responsePreview: responseText.trim().slice(0, 90)
        });
      };

      bridge.onTurnComplete(() => {
        // If a tool was triggered, wait 800ms for response audio to begin if not yet arrived
        if (activeToolName && firstAudioTime === null) {
          setTimeout(() => {
            finishTurn();
          }, 1200);
          return;
        }
        finishTurn();
      });
    });

    // Send user utterance
    (bridge as unknown as { session?: { sendClientContent(args: unknown): void } }).session?.sendClientContent({
      turns: [{ role: "user", parts: [{ text: utterance }] }],
      turnComplete: true
    });

    const timeoutPromise = new Promise<TurnBenchmarkResult>((_, reject) =>
      setTimeout(() => reject(new Error(`Turn ${i + 1} timed out after 14000ms`)), 14000)
    );

    try {
      const turnResult = await Promise.race([turnPromise, timeoutPromise]);
      results.push(turnResult);

      const toolStr = turnResult.toolCalled
        ? ` | Tool: ${turnResult.toolCalled} (${turnResult.toolDurationMs}ms)`
        : "";

      console.log(
        `Turn ${String(turnResult.turn).padStart(2)}: ` +
        `Response Latency: ${String(turnResult.totalLatencyMs).padStart(4)} ms | ` +
        `First Token: ${String(turnResult.firstTokenMs).padStart(4)} ms | ` +
        `Total Turn: ${String(turnResult.turnTotalDurationMs).padStart(5)} ms` +
        toolStr
      );
      console.log(`         User: "${utterance}"`);
      if (turnResult.responsePreview) {
        console.log(`         AI:   "${turnResult.responsePreview}..."`);
      }
      console.log("");

      // Brief conversational gap between turns
      await new Promise((r) => setTimeout(r, 600));
    } catch (err) {
      console.error(`Turn ${i + 1} failed:`, err);
    }
  }

  await bridge.stop();

  if (results.length === 0) {
    console.error("No results recorded.");
    return;
  }

  // Statistical Percentile Calculations
  const latencies = results.map((r) => r.totalLatencyMs).sort((a, b) => a - b);
  const getPercentile = (p: number) => {
    const idx = Math.min(latencies.length - 1, Math.max(0, Math.floor((p / 100) * latencies.length)));
    return latencies[idx]!;
  };

  const min = latencies[0]!;
  const max = latencies[latencies.length - 1]!;
  const p50 = getPercentile(50);
  const p90 = getPercentile(90);
  const p95 = getPercentile(95);
  const mean = Math.round(latencies.reduce((acc, v) => acc + v, 0) / latencies.length);

  const variance = latencies.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / latencies.length;
  const stdDev = Math.round(Math.sqrt(variance));

  const toolTurns = results.filter((r) => r.toolCalled);
  const nonToolTurns = results.filter((r) => !r.toolCalled);

  const meanToolDuration = toolTurns.length
    ? Math.round(toolTurns.reduce((acc, r) => acc + (r.toolDurationMs ?? 0), 0) / toolTurns.length)
    : 0;

  const meanNonToolLatency = nonToolTurns.length
    ? Math.round(nonToolTurns.reduce((acc, r) => acc + r.totalLatencyMs, 0) / nonToolTurns.length)
    : 0;

  console.log("\n================================================================================");
  console.log("              EMPIRICAL LIVE BENCHMARK RESULTS (MEASURED RUNS)                  ");
  console.log("================================================================================");
  console.log(`Total Interaction Turns Tested: ${results.length}`);
  console.log("--------------------------------------------------------------------------------");
  console.log(`  * p50 (Median) Response Latency:   ${p50} ms`);
  console.log(`  * p90 Response Latency:            ${p90} ms`);
  console.log(`  * p95 Response Latency:            ${p95} ms`);
  console.log(`  * Mean (Average) Latency:          ${mean} ms`);
  console.log(`  * Min Latency:                     ${min} ms`);
  console.log(`  * Max Latency:                     ${max} ms`);
  console.log(`  * Std Dev:                         ${stdDev} ms`);
  console.log("--------------------------------------------------------------------------------");
  console.log(`  * Conversational Turns Mean:       ${meanNonToolLatency} ms`);
  if (toolTurns.length > 0) {
    console.log(`  * Tool-Executing Turns:            ${toolTurns.length} turns`);
    console.log(`  * Average Tool Execution Duration: ${meanToolDuration} ms`);
  }
  console.log("================================================================================\n");
}

void runLiveBenchmark().catch((err) => {
  console.error("Benchmark execution error:", err);
  process.exit(1);
});
