/**
 * Composes the pitch video's score from scratch and writes public/score.wav.
 *
 * The music is synthesised rather than licensed so the video carries no
 * third-party rights: a felt piano, a warm pad, a Karplus–Strong pluck, sine
 * bass, soft drums and a bell, through a Freeverb-style room. Everything is
 * deterministic (seeded noise), so re-running reproduces the same file.
 *
 * The arrangement is written in bars against the video's own timeline
 * (src/timeline.ts), so each section change lands on a scene cut.
 *
 *   bun scripts/compose-score.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BAR, BEAT, DURATION, FPS } from "../src/timeline";

const SR = 48_000;
const BEAT_S = BEAT / FPS; // 0.6 s
const BAR_S = BAR / FPS; // 2.4 s
const LENGTH_S = DURATION / FPS; // 30 s
const N = Math.ceil(LENGTH_S * SR);

/** Seconds at a 1-based bar and a beat offset within it. */
const t = (bar: number, beat = 0) => (bar - 1) * BAR_S + beat * BEAT_S;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// ---------------------------------------------------------------- buses --

const dryL = new Float32Array(N);
const dryR = new Float32Array(N);
const send = new Float32Array(N); // mono reverb send

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x2ead);

/** Mixes a mono voice into the buses with equal-power panning (-1..1). */
function mix(start: number, voice: Float32Array, gain: number, pan: number, reverb: number) {
  const i0 = Math.round(start * SR);
  const angle = ((pan + 1) * Math.PI) / 4;
  const gl = Math.cos(angle) * gain;
  const gr = Math.sin(angle) * gain;
  for (let i = 0; i < voice.length; i++) {
    const j = i0 + i;
    if (j < 0) continue;
    if (j >= N) break;
    const s = voice[i]!;
    dryL[j] += s * gl;
    dryR[j] += s * gr;
    send[j] += s * gain * reverb;
  }
}

/** A sine by rotation recurrence: exact frequency, no per-sample sin(). */
function addSine(out: Float32Array, freq: number, amp: number, env: (i: number) => number, phase = 0) {
  if (freq >= SR / 2) return;
  const w = (2 * Math.PI * freq) / SR;
  const k = 2 * Math.cos(w);
  let s1 = Math.sin(phase - w);
  let s0 = Math.sin(phase);
  for (let i = 0; i < out.length; i++) {
    out[i] += s0 * amp * env(i);
    const next = k * s0 - s1;
    s1 = s0;
    s0 = next;
  }
}

// ----------------------------------------------------------- instruments --

/** Felt piano: two slightly detuned strings, soft inharmonic partials. */
function piano(midi: number, velocity: number, length = 3.2) {
  const f = hz(midi);
  const out = new Float32Array(Math.ceil(length * SR));
  const tau = Math.min(3.4, 2.6 * (220 / f) ** 0.35);
  const brightness = 0.55 + 0.45 * velocity;
  const B = 0.00035;
  for (let n = 1; n <= 7; n++) {
    const fn = n * f * Math.sqrt(1 + B * n * n);
    const amp = (brightness ** (n - 1) / n ** 1.5) * 0.5;
    const tn = tau / (1 + 0.65 * (n - 1));
    const env = (i: number) => {
      const s = i / SR;
      const attack = Math.min(1, s / 0.004);
      const release = s > length - 0.25 ? Math.max(0, (length - s) / 0.25) : 1;
      return attack * Math.exp(-s / tn) * release;
    };
    for (const cents of [-0.9, 0.9]) {
      addSine(out, fn * 2 ** (cents / 1200), amp, env, rand() * Math.PI * 2);
    }
  }
  // A breath of felt on the hammer.
  let lp = 0;
  for (let i = 0; i < Math.min(out.length, SR * 0.012); i++) {
    lp += 0.2 * (rand() * 2 - 1 - lp);
    out[i] += lp * 0.05 * velocity * (1 - i / (SR * 0.012));
  }
  return out;
}

/** Warm pad: three detuned additive voices with a slow swell. */
function pad(midi: number, length: number, attack = 1.1, release = 1.6) {
  const f = hz(midi);
  const total = length + release;
  const out = new Float32Array(Math.ceil(total * SR));
  const env = (i: number) => {
    const s = i / SR;
    const a = Math.min(1, s / attack);
    const r = s > length ? Math.max(0, 1 - (s - length) / release) : 1;
    return a * a * (3 - 2 * a) * r * r;
  };
  for (const cents of [-7, 0, 7]) {
    for (let n = 1; n <= 9; n++) {
      const fn = n * f * 2 ** (cents / 1200);
      const amp = (Math.exp((-n * f) / 1400) / n) * 0.12;
      addSine(out, fn, amp, env, rand() * Math.PI * 2);
    }
  }
  return out;
}

/** Karplus–Strong pluck, damped toward a soft, woody tone. */
function pluck(midi: number, length = 1.1) {
  const f = hz(midi);
  const period = Math.max(2, Math.round(SR / f));
  const ring = new Float32Array(period);
  let lp = 0;
  for (let i = 0; i < period; i++) {
    lp += 0.5 * (rand() * 2 - 1 - lp);
    ring[i] = lp;
  }
  const out = new Float32Array(Math.ceil(length * SR));
  let idx = 0;
  for (let i = 0; i < out.length; i++) {
    const a = ring[idx]!;
    const b = ring[(idx + 1) % period]!;
    const v = 0.4975 * (a + b);
    ring[idx] = v;
    idx = (idx + 1) % period;
    const tail = i > out.length - SR * 0.08 ? (out.length - i) / (SR * 0.08) : 1;
    out[i] = a * tail;
  }
  // Gentle low-pass to take the edge off the attack.
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    y += 0.35 * (out[i]! - y);
    out[i] = y;
  }
  return out;
}

function bass(midi: number, length: number) {
  const f = hz(midi);
  const out = new Float32Array(Math.ceil((length + 0.2) * SR));
  const env = (i: number) => {
    const s = i / SR;
    const a = Math.min(1, s / 0.02);
    const r = s > length ? Math.max(0, 1 - (s - length) / 0.2) : 1;
    return a * r * (0.75 + 0.25 * Math.exp(-s / 0.4));
  };
  addSine(out, f, 0.5, env);
  addSine(out, f * 2, 0.12, env);
  return out;
}

function kick(weight = 1, tail = 0.32) {
  const out = new Float32Array(Math.ceil(tail * 3 * SR));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const s = i / SR;
    const f = 44 + 90 * Math.exp(-s / 0.028);
    phase += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(phase) * Math.exp(-s / tail) * 0.9 * weight;
  }
  return out;
}

function hat(decay = 0.028) {
  const out = new Float32Array(Math.ceil(decay * 6 * SR));
  let prev = 0;
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const x = rand() * 2 - 1;
    const hp = x - prev;
    prev = x;
    lp += 0.55 * (hp - lp);
    out[i] = lp * Math.exp(-i / SR / decay) * 0.25;
  }
  return out;
}

/** A soft rim tick for the back beat. */
function tick() {
  const out = new Float32Array(Math.ceil(0.12 * SR));
  addSine(out, 1650, 0.18, (i) => Math.exp(-i / SR / 0.018));
  addSine(out, 820, 0.22, (i) => Math.exp(-i / SR / 0.03));
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    lp += 0.4 * (rand() * 2 - 1 - lp);
    out[i] += lp * 0.18 * Math.exp(-i / SR / 0.012);
  }
  return out;
}

function bell(midi: number, length = 3) {
  const f = hz(midi);
  const out = new Float32Array(Math.ceil(length * SR));
  const partials: [number, number, number][] = [
    [1, 1, 2.4],
    [2.0, 0.35, 1.4],
    [3.01, 0.18, 0.9],
    [4.16, 0.12, 0.55],
    [5.43, 0.07, 0.35],
  ];
  for (const [ratio, amp, decay] of partials) {
    addSine(out, f * ratio, amp * 0.3, (i) => {
      const s = i / SR;
      const release = s > length - 0.2 ? Math.max(0, (length - s) / 0.2) : 1;
      return Math.min(1, s / 0.002) * Math.exp(-s / decay) * release;
    });
  }
  return out;
}

/** Filtered-noise swell whose cutoff and level rise into the next downbeat. */
function riser(length: number) {
  const out = new Float32Array(Math.ceil(length * SR));
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const p = i / out.length;
    const cutoff = 300 + 9000 * p * p;
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    lp += a * (rand() * 2 - 1 - lp);
    out[i] = lp * p ** 2.2 * 0.4;
  }
  return out;
}

// ------------------------------------------------------------- harmony --

type Chord = { root: number; voicing: number[] };
const D: Chord = { root: 38, voicing: [50, 57, 61, 64, 66] }; // Dmaj9
const Bm: Chord = { root: 35, voicing: [47, 54, 57, 61, 62] }; // Bm9
const G: Chord = { root: 31, voicing: [43, 50, 54, 57, 59] }; // Gmaj9
const A: Chord = { root: 33, voicing: [45, 52, 55, 59, 62] }; // A13sus
const PROGRESSION = [D, Bm, G, A, D, Bm, G, A, D, Bm, G];

// Melody: [beat offset, midi, velocity]. One four-bar phrase, played three ways.
const PHRASE: [number, number, number][][] = [
  [
    [0, 69, 0.7],
    [1.5, 66, 0.45],
    [2, 64, 0.5],
    [3, 66, 0.55],
  ],
  [
    [0, 62, 0.6],
    [1.5, 61, 0.4],
    [2, 66, 0.55],
  ],
  [
    [0, 71, 0.7],
    [1.5, 69, 0.45],
    [2, 66, 0.5],
    [3, 69, 0.55],
  ],
  [
    [0, 64, 0.6],
    [2, 61, 0.45],
    [3, 64, 0.5],
  ],
];

// --------------------------------------------------------- arrangement --

for (let bar = 1; bar <= 11; bar++) {
  const chord = PROGRESSION[bar - 1]!;
  const phrase = PHRASE[(bar - 1) % 4]!;
  const lift = bar >= 9 ? 12 : 0;

  // Piano melody throughout; an octave up for the lift.
  for (const [beat, midi, vel] of phrase) {
    mix(t(bar, beat), piano(midi + lift, vel), 0.34, 0.1, 0.55);
  }

  // Pad from the first bar, swelling in; fuller once the groove lands.
  const padGain = bar <= 2 ? 0.55 : bar <= 4 ? 0.7 : 0.8;
  chord.voicing.slice(1).forEach((midi, v) => {
    mix(t(bar) - 0.05, pad(midi, BAR_S + 0.1), padGain, v % 2 ? 0.45 : -0.45, 0.7);
  });

  // Rolled piano chord on the downbeat once the reader appears.
  if (bar >= 3) {
    chord.voicing.forEach((midi, v) => {
      mix(t(bar) + v * 0.018, piano(midi, 0.35, 2.4), 0.2, -0.2 + v * 0.1, 0.6);
    });
  }

  // Pluck arpeggio in eighths, ping-ponged.
  if (bar >= 3) {
    const pattern = [0, 1, 2, 3, 4, 3, 2, 1];
    const gain = bar <= 4 ? 0.22 : 0.3;
    pattern.forEach((p, k) => {
      mix(t(bar, k / 2), pluck(chord.voicing[p]! + 12), gain, k % 2 ? 0.55 : -0.55, 0.45);
    });
  }

  // Bass and kick from the "ask" scene on.
  if (bar >= 5) {
    mix(t(bar), bass(chord.root + 12, BAR_S - 0.1), 0.42, 0, 0.05);
    const kicks = bar === 11 ? [0, 1, 2, 3] : [0, 2];
    for (const beat of kicks) mix(t(bar, beat), kick(bar === 11 ? 0.9 : 0.75), 0.9, 0, 0.02);
  }

  // Air: off-beat hats from the memory scene, sixteenths in the final push.
  if (bar >= 7) {
    const hats = bar === 11 ? Array.from({ length: 16 }, (_, k) => k / 4) : [0.5, 1.5, 2.5, 3.5];
    for (const beat of hats) mix(t(bar, beat), hat(), bar === 11 ? 0.32 : 0.4, 0.3, 0.1);
  }
  if (bar >= 9) {
    for (const beat of [1, 3]) mix(t(bar, beat), tick(), 0.35, -0.15, 0.25);
  }

  // Bell doubling the lifted melody.
  if (bar >= 9) {
    for (const [beat, midi, vel] of phrase) {
      mix(t(bar, beat), bell(midi + 12, 2.2), 0.16 * vel, 0.35, 0.8);
    }
  }
}

// Swells into the "ask" scene and into the closing card.
mix(t(5) - BEAT_S * 2, riser(BEAT_S * 2), 0.5, 0, 0.4);
mix(t(12) - BEAT_S * 3, riser(BEAT_S * 3), 0.7, 0, 0.5);

// The closing chord: everything resolves on D and rings out under the card.
const FINAL = t(12);
const finalVoicing = [38, 45, 50, 54, 57, 64, 66];
finalVoicing.forEach((midi, v) => mix(FINAL + v * 0.022, piano(midi, 0.6, 3.6), 0.26, -0.3 + v * 0.1, 0.7));
[57, 61, 64, 66].forEach((midi, v) => mix(FINAL, pad(midi, 2.2, 0.08, 1.4), 0.8, v % 2 ? 0.5 : -0.5, 0.8));
mix(FINAL, piano(74, 0.75, 3.6), 0.36, 0.1, 0.7);
mix(FINAL, bell(86, 3.6), 0.2, 0.3, 0.9);
mix(FINAL + BEAT_S, bell(81, 2.6), 0.12, -0.3, 0.9);
mix(FINAL, bass(26, 2.4), 0.5, 0, 0.1);
mix(FINAL, kick(1, 0.6), 0.9, 0, 0.15);

// --------------------------------------------------------------- reverb --

function freeverb(input: Float32Array, spread: number) {
  const scale = SR / 44_100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round((d + spread) * scale));
  const allpasses = [556, 441, 341, 225].map((d) => Math.round((d + spread) * scale));
  const feedback = 0.28 * 0.86 + 0.7;
  const damp = 0.3;
  const out = new Float32Array(input.length);
  const combBufs = combs.map((d) => ({ buf: new Float32Array(d), i: 0, store: 0 }));
  const apBufs = allpasses.map((d) => ({ buf: new Float32Array(d), i: 0 }));
  for (let n = 0; n < input.length; n++) {
    const x = input[n]! * 0.015;
    let acc = 0;
    for (const c of combBufs) {
      const y = c.buf[c.i]!;
      c.store = y * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * feedback;
      c.i = (c.i + 1) % c.buf.length;
      acc += y;
    }
    for (const a of apBufs) {
      const b = a.buf[a.i]!;
      a.buf[a.i] = acc + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      acc = b - acc;
    }
    out[n] = acc;
  }
  return out;
}

// Pre-delay the send a little so the dry attack stays clear.
const predelay = Math.round(0.022 * SR);
const delayed = new Float32Array(N);
delayed.set(send.subarray(0, N - predelay), predelay);
const wetL = freeverb(delayed, 0);
const wetR = freeverb(delayed, 23);

// --------------------------------------------------------------- master --

// Reverb return sits under the dry signal rather than on top of it.
const WET = 1.0;
const outL = new Float32Array(N);
const outR = new Float32Array(N);
let hpL = 0;
let hpR = 0;
let xL = 0;
let xR = 0;
let busPeak = 0;
const hpA = Math.exp((-2 * Math.PI * 28) / SR);
for (let i = 0; i < N; i++) {
  const l = dryL[i]! + wetL[i]! * WET;
  const r = dryR[i]! + wetR[i]! * WET;
  // One-pole high-pass at 28 Hz to clear DC and sub rumble.
  hpL = hpA * (hpL + l - xL);
  hpR = hpA * (hpR + r - xR);
  xL = l;
  xR = r;
  outL[i] = hpL;
  outR[i] = hpR;
  busPeak = Math.max(busPeak, Math.abs(hpL), Math.abs(hpR));
}

// Trim the bus so its loudest moment meets the saturator at 0.8: tanh then
// only rounds the rare transient instead of squashing the whole mix.
const drive = 0.8 / busPeak;
for (let i = 0; i < N; i++) {
  outL[i] = Math.tanh(outL[i]! * drive);
  outR[i] = Math.tanh(outR[i]! * drive);
}

// Fades: a whisker in, and a closing fade over the last second.
const fadeIn = Math.round(0.02 * SR);
const fadeOut = Math.round(1.1 * SR);
for (let i = 0; i < N; i++) {
  let g = 1;
  if (i < fadeIn) g = i / fadeIn;
  if (i > N - fadeOut) g = Math.min(g, ((N - i) / fadeOut) ** 1.6);
  outL[i] *= g;
  outR[i] *= g;
}

let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(outL[i]!), Math.abs(outR[i]!));
const norm = 10 ** (-1 / 20) / peak; // -1 dBFS

// ------------------------------------------------------------------ wav --

const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outL[i]! * norm)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outR[i]! * norm)) * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(2, 22); // stereo
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const target = join(dirname(new URL(import.meta.url).pathname), "..", "public", "score.wav");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, Buffer.concat([header, data]));
console.log(`score: ${LENGTH_S}s → ${target}`);
