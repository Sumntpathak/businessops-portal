"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, PhoneOff, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, PageShell } from "@/components/dashboard/page-shell";
import { mulawToPcm16, pcm16ToMulaw } from "@/lib/mulaw";

const VOICE_SERVER_WS_URL =
  process.env.NEXT_PUBLIC_VOICE_WS_URL ?? "ws://localhost:3001";
const TARGET_SAMPLE_RATE = 8000;

const VOICE_OPTIONS = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse"
] as const;

type CallState = "idle" | "connecting" | "live" | "ended";
type TranscriptRole = "caller" | "agent" | "tool" | "system";
interface TranscriptLine {
  role: TranscriptRole;
  content: string;
  at: string;
}

function downsampleTo8k(input: Float32Array, inputRate: number): Int16Array {
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const sample = input[Math.floor(i * ratio)] ?? 0;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  }
  return out;
}

function roleStyle(role: TranscriptRole): string {
  switch (role) {
    case "caller":
      return "ml-auto bg-primary text-primary-foreground";
    case "agent":
      return "bg-muted";
    case "tool":
      return "border border-dashed bg-transparent font-mono text-xs";
    case "system":
      return "border bg-transparent text-xs text-muted-foreground";
  }
}

export default function VoiceTestPage() {
  const [state, setState] = useState<CallState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [voice, setVoice] = useState<(typeof VOICE_OPTIONS)[number]>("marin");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);

  const socketRef = useRef<WebSocket>();
  const audioContextRef = useRef<AudioContext>();
  const mediaStreamRef = useRef<MediaStream>();
  const processorRef = useRef<ScriptProcessorNode>();
  const playbackTimeRef = useRef(0);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const playMulawFrame = useCallback((bytes: Uint8Array) => {
    const context = audioContextRef.current;
    if (!context) return;
    const pcm16 = mulawToPcm16(bytes);
    const buffer = context.createBuffer(1, pcm16.length, TARGET_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i += 1) channel[i] = (pcm16[i] ?? 0) / 32768;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime, playbackTimeRef.current);
    source.start(startAt);
    playbackTimeRef.current = startAt + buffer.duration;
  }, []);

  const stopCall = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = undefined;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = undefined;
    socketRef.current?.close(1000, "User ended test call");
    socketRef.current = undefined;
    void audioContextRef.current?.close();
    audioContextRef.current = undefined;
    playbackTimeRef.current = 0;
    setState("ended");
  }, []);

  const startCall = useCallback(async () => {
    setErrorMessage("");
    setTranscript([]);
    setState("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const context = new AudioContext();
      audioContextRef.current = context;

      const wsUrl = new URL(VOICE_SERVER_WS_URL.replace(/\/$/, "") + "/browser-test");
      wsUrl.searchParams.set("voice", voice);
      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        const source = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (event) => {
          if (socket.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          const pcm16 = downsampleTo8k(input, context.sampleRate);
          const mulaw = pcm16ToMulaw(pcm16);
          socket.send(mulaw);
        };
        // ScriptProcessor only runs while connected to a destination; route through a silent
        // gain node so the mic input isn't also played back out loud (echo).
        const silentGain = context.createGain();
        silentGain.gain.value = 0;
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(context.destination);
      };

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data) as {
            event: string;
            callId?: string;
            role?: TranscriptRole;
            content?: string;
            at?: string;
          };
          if (message.event === "ready") setState("live");
          if (message.event === "transcript" && message.role && message.content) {
            setTranscript((current) => [
              ...current,
              { role: message.role as TranscriptRole, content: message.content as string, at: message.at ?? new Date().toISOString() }
            ]);
          }
          return;
        }
        playMulawFrame(new Uint8Array(event.data as ArrayBuffer));
      };

      socket.onerror = () => setErrorMessage("Connection to the voice server failed.");
      socket.onclose = () => setState((current) => (current === "connecting" ? "idle" : "ended"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not start the test call.");
      setState("idle");
    }
  }, [playMulawFrame, voice]);

  useEffect(() => () => stopCall(), [stopCall]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const callActive = state === "live" || state === "connecting";

  return (
    <PageShell>
      <PageHeader eyebrow="Internal tool" title="Voice agent test">
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Talk to the agent directly from your browser microphone. This never touches Twilio or
          the live phone number — it is a separate test path against the same Azure Realtime agent.
        </p>
      </PageHeader>
      <PageBody className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border p-6">
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium capitalize">{state}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {state === "idle" && "Choose a voice and start."}
            {state === "connecting" && "Connecting to the voice server…"}
            {state === "live" && "Speak naturally — the agent is listening."}
            {state === "ended" && "Test call ended."}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Voice</span>
          <select
            value={voice}
            onChange={(event) => setVoice(event.target.value as (typeof VOICE_OPTIONS)[number])}
            disabled={callActive}
            className="h-9 rounded-md border bg-background px-3 text-sm capitalize appearance-auto disabled:opacity-50"
          >
            {VOICE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        {callActive ? (
          <Button variant="outline" onClick={stopCall} className="gap-2">
            <PhoneOff className="h-4 w-4" />
            End test call
          </Button>
        ) : (
          <Button onClick={() => void startCall()} className="gap-2">
            <Mic className="h-4 w-4" />
            Start test call
          </Button>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <section className="mt-6 rounded-xl border">
        <div className="border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Live transcript &amp; tool calls</h2>
        </div>
        <div className="max-h-[420px] min-h-[160px] space-y-3 overflow-y-auto p-5">
          {transcript.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {callActive ? "Waiting for the conversation to start…" : "Start a test call to see the live transcript here."}
            </p>
          ) : (
            transcript.map((line, index) => (
              <div
                key={index}
                className={"max-w-[85%] rounded-lg px-3 py-2 text-sm leading-6 " + roleStyle(line.role)}
              >
                <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide opacity-70">
                  {line.role === "tool" && <Wrench className="h-3 w-3" />}
                  <span>{line.role}</span>
                  <time>{new Date(line.at).toLocaleTimeString()}</time>
                </div>
                <p className="whitespace-pre-wrap break-words">{line.content}</p>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        Transcripts and call records from this test also appear in Calls under the
        Browser tests tab.
      </p>
      </PageBody>
    </PageShell>
  );
}
