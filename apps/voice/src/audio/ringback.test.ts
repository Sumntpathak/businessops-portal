import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRingbackWav } from "./ringback.js";

describe("buildRingbackWav", () => {
  it("produces a valid 8 kHz mono 16-bit WAV of one 3 second cadence", () => {
    const wav = buildRingbackWav();
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.readUInt32LE(24), 8000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt16LE(34), 16);
    const dataBytes = wav.readUInt32LE(40);
    assert.equal(dataBytes, 3 * 8000 * 2);
    assert.equal(wav.length, 44 + dataBytes);
  });

  it("rings, then goes silent in the gap and the long pause", () => {
    const wav = buildRingbackWav();
    const sampleAt = (ms: number) => wav.readInt16LE(44 + Math.round((ms / 1000) * 8000) * 2);
    const peak = (fromMs: number, toMs: number) => {
      let max = 0;
      for (let ms = fromMs; ms < toMs; ms += 1) max = Math.max(max, Math.abs(sampleAt(ms)));
      return max;
    };
    assert.ok(peak(0, 400) > 1000, "first ring is audible");
    assert.equal(peak(400, 600), 0, "gap between rings is silent");
    assert.ok(peak(600, 1000) > 1000, "second ring is audible");
    assert.equal(peak(1000, 3000), 0, "trailing pause is silent");
  });

  it("repeats the cadence when asked for more cycles", () => {
    assert.equal(buildRingbackWav(2).readUInt32LE(40), 2 * 3 * 8000 * 2);
  });
});
