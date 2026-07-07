"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mulawToPcm16, pcm16ToMulaw } from "@/lib/mulaw";

const VOICE_SERVER_WS_URL =
  process.env.NEXT_PUBLIC_VOICE_WS_URL ?? "ws://localhost:3001";
const TARGET_SAMPLE_RATE = 8000;

type CallState = "idle" | "connecting" | "live" | "ended";

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

export default function VoiceTestPage() {
  const [state, setState] = useState<CallState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const socketRef = useRef<WebSocket>();
  const audioContextRef = useRef<AudioContext>();
  const mediaStreamRef = useRef<MediaStream>();
  const processorRef = useRef<ScriptProcessorNode>();
  const playbackTimeRef = useRef(0);

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
    setState("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const context = new AudioContext();
      audioContextRef.current = context;

      const socket = new WebSocket(VOICE_SERVER_WS_URL.replace(/\/$/, "") + "/browser-test");
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
          const message = JSON.parse(event.data) as { event: string; callId?: string };
          if (message.event === "ready") setState("live");
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
  }, [playMulawFrame]);

  useEffect(() => () => stopCall(), [stopCall]);

  return (
    <section className="mx-auto max-w-2xl">
      <p className="text-sm text-muted-foreground">Internal tool</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Voice agent test</h1>
      <p className="mt-3 max-w-xl leading-7 text-muted-foreground">
        Talk to the Holistic Migration Solutions agent directly from your browser microphone.
        This never touches Twilio or the live phone number — it is a separate test path against
        the same Azure Realtime agent.
      </p>

      <div className="mt-8 flex items-center gap-4 rounded-xl border p-6">
        <div className="flex-1">
          <p className="text-sm font-medium capitalize">{state}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {state === "idle" && "Click start and allow microphone access."}
            {state === "connecting" && "Connecting to the voice server…"}
            {state === "live" && "Speak naturally — the agent is listening."}
            {state === "ended" && "Test call ended."}
          </p>
        </div>
        {state === "live" || state === "connecting" ? (
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

      <p className="mt-6 text-xs text-muted-foreground">
        Transcripts and call records from this test appear in Calls and Callers, tagged with a
        synthetic phone number.
      </p>
    </section>
  );
}
