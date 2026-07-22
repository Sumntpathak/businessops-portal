import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  base64PcmToInt16,
  int16ToBase64Pcm,
  mulawToPcm16,
  pcm16ToMulaw,
  resampleLinear
} from "./mulaw-pcm.js";

describe("mulaw <-> pcm16 roundtrip", () => {
  it("roundtrips a simple waveform within mu-law's lossy tolerance", () => {
    const original = new Int16Array([0, 1000, -1000, 5000, -5000, 16000, -16000, 32000]);
    const encoded = pcm16ToMulaw(original);
    const decoded = mulawToPcm16(encoded);

    assert.equal(decoded.length, original.length);
    for (let i = 0; i < original.length; i += 1) {
      const expected = original[i] ?? 0;
      const actual = decoded[i] ?? 0;
      const error = Math.abs(actual - expected);
      // mu-law is a lossy log codec; tolerate quantization error proportional to magnitude.
      assert.ok(error <= Math.max(200, Math.abs(expected) * 0.05), `sample ${i}: expected ~${expected}, got ${actual}`);
    }
  });

  it("round-trips silence exactly", () => {
    const silence = new Int16Array(160).fill(0);
    const decoded = mulawToPcm16(pcm16ToMulaw(silence));
    assert.ok(decoded.every((sample) => Math.abs(sample) < 50));
  });
});

describe("resampleLinear", () => {
  it("returns the input unchanged when rates match", () => {
    const samples = new Int16Array([1, 2, 3, 4]);
    assert.equal(resampleLinear(samples, 8_000, 8_000), samples);
  });

  it("upsamples 8kHz to 16kHz to roughly double the sample count", () => {
    const samples = new Int16Array(80).fill(1000);
    const result = resampleLinear(samples, 8_000, 16_000);
    assert.equal(result.length, 160);
    assert.ok(result.every((sample) => Math.abs(sample - 1000) < 5));
  });

  it("downsamples 24kHz to 8kHz to roughly a third of the sample count", () => {
    const samples = new Int16Array(240).fill(-2000);
    const result = resampleLinear(samples, 24_000, 8_000);
    assert.equal(result.length, 80);
    assert.ok(result.every((sample) => Math.abs(sample - -2000) < 5));
  });

  it("interpolates between two known points", () => {
    const samples = new Int16Array([0, 100]);
    const result = resampleLinear(samples, 2, 4);
    assert.equal(result.length, 4);
    assert.equal(result[0], 0);
  });
});

describe("base64 pcm helpers", () => {
  it("roundtrips signed 16-bit samples exactly through base64", () => {
    const original = new Int16Array([0, 1, -1, 32767, -32768, 12345, -12345]);
    const roundtripped = base64PcmToInt16(int16ToBase64Pcm(original));
    assert.deepEqual(Array.from(roundtripped), Array.from(original));
  });
});
