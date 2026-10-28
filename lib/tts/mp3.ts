// Minimal MP3 utilities for stitching TTS chunks into one playable file.
// Each chunk from ElevenLabs is a standalone MP3 (may carry ID3 and a Xing/Info
// frame). Concatenating raw files makes some players report a wrong duration, so we
// strip per-chunk headers and join bare MPEG frames, which every browser decodes.

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

interface FrameHeader {
  length: number;
  samples: number;
  sampleRate: number;
  sideInfo: number;
}

function parseHeader(b: Uint8Array, o: number): FrameHeader | null {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[o + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (b[o + 1] >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const brIdx = (b[o + 2] >> 4) & 0xf;
  const srIdx = (b[o + 2] >> 2) & 3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const padding = (b[o + 2] >> 1) & 1;
  const mono = ((b[o + 3] >> 6) & 3) === 3;
  const v1 = version === 3;
  const bitrate = (v1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[brIdx] * 1000;
  const sampleRate = SAMPLE_RATES[version][srIdx];
  const length = Math.floor(((v1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  return { length, samples: v1 ? 1152 : 576, sampleRate, sideInfo: v1 ? (mono ? 17 : 32) : mono ? 9 : 17 };
}

function id3v2Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

/** Return only the audio frames: no ID3v2/ID3v1 tags, no Xing/Info/VBRI header frame. */
export function stripMp3Headers(b: Uint8Array): Uint8Array {
  let start = id3v2Size(b);
  while (start < b.length - 4 && !parseHeader(b, start)) start++;
  const first = parseHeader(b, start);
  if (first) {
    const tagAt = start + 4 + first.sideInfo;
    const tag = String.fromCharCode(...b.subarray(tagAt, tagAt + 4));
    const vbri = String.fromCharCode(...b.subarray(start + 36, start + 40));
    if (tag === "Xing" || tag === "Info" || vbri === "VBRI") start += first.length;
  }
  let end = b.length;
  if (end - start >= 128 && b[end - 128] === 0x54 && b[end - 127] === 0x41 && b[end - 126] === 0x47) end -= 128;
  return b.subarray(start, end);
}

export function concatMp3(chunks: Uint8Array[]): Uint8Array {
  const parts = chunks.map(stripMp3Headers);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Duration in seconds by walking MPEG frames. */
export function mp3Duration(b: Uint8Array): number {
  let o = id3v2Size(b);
  let seconds = 0;
  while (o < b.length - 4) {
    const h = parseHeader(b, o);
    if (!h) {
      o++;
      continue;
    }
    seconds += h.samples / h.sampleRate;
    o += h.length;
  }
  return seconds;
}

/** Silent MPEG-1 Layer III audio (128 kbps, 44.1 kHz, mono) for the keyless demo mode. */
export function silentMp3(seconds: number): Uint8Array {
  const frameLen = 417; // floor(144 * 128000 / 44100), no padding
  const frames = Math.max(1, Math.ceil((seconds * 44100) / 1152));
  const out = new Uint8Array(frameLen * frames);
  for (let i = 0; i < frames; i++) {
    const o = i * frameLen;
    out[o] = 0xff;
    out[o + 1] = 0xfb; // MPEG-1, Layer III, no CRC
    out[o + 2] = 0x90; // 128 kbps, 44.1 kHz, no padding
    out[o + 3] = 0xc4; // mono, original
    // side info + main data stay zero: part2_3_length = 0 → decodes to silence
  }
  return out;
}

/** Sample rate and channel count of the first frame — chunks must match to be concatenated. */
export function mp3Format(b: Uint8Array): { sampleRate: number; channels: number } | null {
  let o = id3v2Size(b);
  while (o < b.length - 4) {
    const h = parseHeader(b, o);
    if (h) return { sampleRate: h.sampleRate, channels: ((b[o + 3] >> 6) & 3) === 3 ? 1 : 2 };
    o++;
  }
  return null;
}
