import * as alawmulawPkg from "alawmulaw";

const alawmulawModule = (alawmulawPkg as unknown as { default?: { mulaw?: typeof alawmulawPkg.mulaw } }).default ?? alawmulawPkg;
const mulaw = alawmulawModule.mulaw ?? (alawmulawPkg as unknown as { mulaw: typeof alawmulawPkg.mulaw }).mulaw;

/**
 * Precomputed 256-entry lookup table for instantaneous mu-law -> PCM16 decoding.
 */
const MULAW_TO_PCM16_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i += 1) {
  const decoded = mulaw.decode(new Uint8Array([i]));
  MULAW_TO_PCM16_TABLE[i] = decoded[0] ?? 0;
}

/** Decodes a Twilio G.711 mu-law payload into PCM16 samples using lookup table. */
export function mulawToPcm16(buffer: Buffer): Int16Array {
  const length = buffer.length;
  const samples = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    samples[i] = MULAW_TO_PCM16_TABLE[buffer[i]!] ?? 0;
  }
  return samples;
}

/** Encodes PCM16 samples into a G.711 mu-law payload for Twilio. */
export function pcm16ToMulaw(samples: Int16Array): Buffer {
  return Buffer.from(mulaw.encode(samples));
}

/**
 * One-pole low-pass IIR filter, applied before decimation to attenuate
 * content above the target Nyquist frequency. Without this, downsampling by
 * simple interpolation aliases high frequencies back down as audible
 * muffling/robotic artifacts.
 */
function lowPassFilter(samples: Int16Array, sampleRate: number, cutoffHz: number): Int16Array {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);

  const output = new Int16Array(samples.length);
  let previous = samples[0] ?? 0;
  output[0] = previous;
  for (let i = 1; i < samples.length; i += 1) {
    const current = samples[i] ?? 0;
    const filtered = previous + alpha * (current - previous);
    output[i] = Math.round(filtered);
    previous = filtered;
  }
  return output;
}

/**
 * Linear-interpolation resample between two sample rates, with an
 * anti-aliasing low-pass pass first when downsampling.
 * Optimized with fast paths for common voice ratios (8k <-> 16k and 24k -> 8k).
 */
export function resampleLinear(
  samples: Int16Array,
  fromRate: number,
  toRate: number
): Int16Array {
  if (fromRate === toRate || samples.length === 0) return samples;

  // Fast path: 8kHz -> 16kHz (inbound telephony to Gemini Live 16k input)
  if (fromRate === 8_000 && toRate === 16_000) {
    const outLength = samples.length * 2;
    const output = new Int16Array(outLength);
    for (let i = 0; i < samples.length; i += 1) {
      const curr = samples[i] ?? 0;
      const next = i + 1 < samples.length ? (samples[i + 1] ?? curr) : curr;
      output[i * 2] = curr;
      output[i * 2 + 1] = Math.round((curr + next) * 0.5);
    }
    return output;
  }

  // Fast path: 24kHz -> 8kHz (Gemini Live 24k output to Twilio 8k telephony)
  if (fromRate === 24_000 && toRate === 8_000) {
    const filtered = lowPassFilter(samples, 24_000, 3_200);
    const outLength = Math.max(1, Math.floor(filtered.length / 3));
    const output = new Int16Array(outLength);
    for (let i = 0; i < outLength; i += 1) {
      output[i] = filtered[i * 3] ?? 0;
    }
    return output;
  }

  const isDownsampling = toRate < fromRate;
  const source = isDownsampling
    ? lowPassFilter(samples, fromRate, toRate / 2)
    : samples;

  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Int16Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const sourceIndex = i * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(lower + 1, source.length - 1);
    const weight = sourceIndex - lower;
    const lowerSample = source[lower] ?? 0;
    const upperSample = source[upper] ?? lowerSample;
    output[i] = Math.round(lowerSample * (1 - weight) + upperSample * weight);
  }

  return output;
}

/** Twilio mu-law 8kHz -> PCM16 at the target input rate Gemini Live expects. */
export function twilioMulawToPcm(buffer: Buffer, targetRate: number): Int16Array {
  const pcm8k = mulawToPcm16(buffer);
  return resampleLinear(pcm8k, 8_000, targetRate);
}

/** Gemini Live PCM16 output at its native rate -> Twilio mu-law 8kHz. */
export function pcmToTwilioMulaw(samples: Int16Array, sourceRate: number): Buffer {
  const pcm8k = resampleLinear(samples, sourceRate, 8_000);
  return pcm16ToMulaw(pcm8k);
}

/** Decodes a base64 PCM16 little-endian payload (as sent by Gemini Live) into samples. */
export function base64PcmToInt16(base64: string): Int16Array {
  const bytes = Buffer.from(base64, "base64");
  const sampleCount = Math.floor(bytes.length / 2);
  const samples = new Int16Array(sampleCount);
  if (bytes.byteOffset % 2 === 0) {
    samples.set(new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount));
  } else {
    for (let i = 0; i < sampleCount; i += 1) {
      samples[i] = bytes.readInt16LE(i * 2);
    }
  }
  return samples;
}

/** Encodes PCM16 samples as a base64 little-endian payload (as Gemini Live expects). */
export function int16ToBase64Pcm(samples: Int16Array): string {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString("base64");
}

/** Computes the Root Mean Square (RMS) energy level of PCM16 audio samples. */
export function computeRms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}
