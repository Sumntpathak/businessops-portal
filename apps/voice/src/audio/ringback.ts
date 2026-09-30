const SAMPLE_RATE = 8000;
const AMPLITUDE = 0.25;

/** Australian ringback: 400 Hz + 450 Hz together. */
const TONE_HZ = [400, 450];

/** One cadence cycle: ring 0.4 s, gap 0.2 s, ring 0.4 s, silence 2.0 s. */
const CADENCE_MS: ReadonlyArray<{ on: boolean; ms: number }> = [
  { on: true, ms: 400 },
  { on: false, ms: 200 },
  { on: true, ms: 400 },
  { on: false, ms: 2000 }
];

/**
 * Builds an 8 kHz mono 16-bit PCM WAV of an Australian-style ringback tone, so a
 * caller hears the familiar "connecting" ring while a transfer is being set up.
 */
export function buildRingbackWav(cycles = 1): Buffer {
  const samples: number[] = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (const segment of CADENCE_MS) {
      const count = Math.round((segment.ms / 1000) * SAMPLE_RATE);
      for (let i = 0; i < count; i += 1) {
        if (!segment.on) {
          samples.push(0);
          continue;
        }
        const t = i / SAMPLE_RATE;
        const mixed = TONE_HZ.reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * t), 0) / TONE_HZ.length;
        samples.push(Math.round(mixed * AMPLITUDE * 32767));
      }
    }
  }

  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); // fmt chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  wav.writeUInt16LE(2, 32); // block align
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, index) => wav.writeInt16LE(sample, 44 + index * 2));
  return wav;
}
