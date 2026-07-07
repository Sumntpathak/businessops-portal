const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

export function pcm16ToMulaw(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = encodeSample(samples[i] ?? 0);
  }
  return out;
}

export function mulawToPcm16(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[i] = decodeSample(bytes[i] ?? 0);
  }
  return out;
}

function encodeSample(sample: number): number {
  let value = sample;
  const sign = value < 0 ? 0x80 : 0;
  if (sign) value = -value;
  if (value > MULAW_CLIP) value = MULAW_CLIP;
  value += MULAW_BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function decodeSample(muLawByte: number): number {
  const inverted = ~muLawByte & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  let value = ((mantissa << 3) + MULAW_BIAS) << exponent;
  value -= MULAW_BIAS;
  return sign ? -value : value;
}
