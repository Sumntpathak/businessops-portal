import alawmulaw from "alawmulaw";

const { mulaw } = alawmulaw;

/** Decodes a Twilio G.711 mu-law payload into PCM16 samples. */
export function mulawToPcm16(buffer: Buffer): Int16Array {
  return mulaw.decode(new Uint8Array(buffer));
}

/** Encodes PCM16 samples into a G.711 mu-law payload for Twilio. */
export function pcm16ToMulaw(samples: Int16Array): Buffer {
  return Buffer.from(mulaw.encode(samples));
}

/**
 * Linear-interpolation resample between two sample rates. Not a sinc/polyphase
 * filter — adequate for phone-quality voice audio, and a single resample pass
 * (rather than cascading through an intermediate rate) minimizes compounding
 * interpolation error in either direction.
 */
export function resampleLinear(
  samples: Int16Array,
  fromRate: number,
  toRate: number
): Int16Array {
  if (fromRate === toRate || samples.length === 0) return samples;

  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Int16Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const sourceIndex = i * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(lower + 1, samples.length - 1);
    const weight = sourceIndex - lower;
    const lowerSample = samples[lower] ?? 0;
    const upperSample = samples[upper] ?? lowerSample;
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
  const samples = new Int16Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = bytes.readInt16LE(i * 2);
  }
  return samples;
}

/** Encodes PCM16 samples as a base64 little-endian payload (as Gemini Live expects). */
export function int16ToBase64Pcm(samples: Int16Array): string {
  const bytes = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    bytes.writeInt16LE(samples[i] ?? 0, i * 2);
  }
  return bytes.toString("base64");
}
