/**
 * Pemeriksaan berkas media di sisi server (tanpa decoder): jenis sebenarnya dari magic bytes (bukan Content-Type klien),
 * durasi dari struktur kontainer, dan dimensi gambar. Server tidak pernah memercayai ekstensi/Content-Type dari klien.
 *
 * Catatan durasi: rekaman MediaRecorder (WebM Chrome/Android, MP4 pecahan Safari/iOS) sering tidak punya durasi di
 * header. Parser di bawah menghitungnya dari timecode klaster (WebM) atau tabel `trun` (MP4 pecahan) sehingga batas
 * 10 detik video tetap ditegakkan di server, bukan hanya di klien.
 */
export type MediaKind = "audio" | "video" | "photo";

export interface MediaInfo {
  kind: MediaKind;
  mime: string;
  /** 0 untuk foto. */
  durationMs: number;
  width: number;
  height: number;
  /** true/false bila server bisa menentukan (hanya WAV); null bila tidak bisa. */
  silent: boolean | null;
}

export class MediaRejected extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const ascii = (b: Uint8Array, off: number, len: number) => String.fromCharCode(...b.subarray(off, off + len));
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u32le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;

/** Menentukan jenis dari byte awal. */
export function sniff(b: Uint8Array): "wav" | "mp4" | "ogg" | "mp3" | "webm" | "jpeg" | "png" | "webp" | "gif" | null {
  if (b.length < 16) return null;
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (ascii(b, 4, 4) === "ftyp") return "mp4";
  if (ascii(b, 0, 4) === "OggS") return "ogg";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "png";
  if (ascii(b, 0, 3) === "GIF") return "gif";
  if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return "mp3";
  return null;
}

/** Periksa satu berkas media apa pun jenisnya. `hintMs` = durasi laporan klien, dipakai hanya bila server tak bisa menghitung. */
export function inspectMedia(bytes: Uint8Array, hintMs = 0): MediaInfo {
  const t = sniff(bytes);
  if (!t) throw new MediaRejected("media_unsupported");
  switch (t) {
    case "jpeg": case "png": case "webp": case "gif": {
      const d = imageDims(bytes, t);
      return { kind: "photo", mime: t === "jpeg" ? "image/jpeg" : `image/${t}`, durationMs: 0, width: d.w, height: d.h, silent: null };
    }
    case "wav": { const w = parseWav(bytes); return { kind: "audio", mime: "audio/wav", durationMs: w.durationMs, width: 0, height: 0, silent: w.silent }; }
    case "ogg": return { kind: "audio", mime: "audio/ogg", durationMs: parseOgg(bytes), width: 0, height: 0, silent: null };
    case "mp3": return { kind: "audio", mime: "audio/mpeg", durationMs: parseMp3(bytes), width: 0, height: 0, silent: null };
    case "mp4": {
      const m = parseMp4(bytes);
      const brand = ascii(bytes, 8, 4);
      if (m.hasVideo) return { kind: "video", mime: brand === "qt  " ? "video/quicktime" : "video/mp4", durationMs: m.durationMs || hintMs, width: m.width, height: m.height, silent: null };
      if (!m.hasAudio) throw new MediaRejected("media_corrupt");
      return { kind: "audio", mime: "audio/mp4", durationMs: m.durationMs || hintMs, width: 0, height: 0, silent: null };
    }
    case "webm": {
      const w = parseWebm(bytes);
      if (w.hasVideo) return { kind: "video", mime: "video/webm", durationMs: w.durationMs || hintMs, width: w.width, height: w.height, silent: null };
      if (!w.hasAudio) throw new MediaRejected("media_corrupt");
      return { kind: "audio", mime: "audio/webm", durationMs: w.durationMs || hintMs, width: 0, height: 0, silent: null };
    }
  }
}

// ---------------------------------------------------------------- Gambar
function imageDims(b: Uint8Array, t: "jpeg" | "png" | "webp" | "gif"): { w: number; h: number } {
  let w = 0, h = 0;
  if (t === "png") {
    if (ascii(b, 12, 4) !== "IHDR") throw new MediaRejected("media_corrupt");
    w = u32be(b, 16); h = u32be(b, 20);
  } else if (t === "gif") {
    w = u16le(b, 6); h = u16le(b, 8);
  } else if (t === "webp") {
    const fmt = ascii(b, 12, 4);
    if (fmt === "VP8 ") { w = u16le(b, 26) & 0x3fff; h = u16le(b, 28) & 0x3fff; }
    else if (fmt === "VP8L") {
      const v = u32le(b, 21);
      w = (v & 0x3fff) + 1; h = ((v >> 14) & 0x3fff) + 1;
    } else if (fmt === "VP8X") {
      w = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1; h = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1;
    } else throw new MediaRejected("media_corrupt");
  } else {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1]!;
      if (m === 0xff) { p++; continue; }
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
      const len = u16be(b, p + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = u16be(b, p + 5); w = u16be(b, p + 7); break; }
      p += 2 + len;
    }
  }
  if (w < 1 || h < 1) throw new MediaRejected("media_corrupt");
  return { w, h };
}

// ---------------------------------------------------------------- WAV
function parseWav(b: Uint8Array): { durationMs: number; silent: boolean | null } {
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; byteRate: number; bits: number } | null = null;
  while (pos + 8 <= b.length) {
    const id = ascii(b, pos, 4);
    const size = u32le(b, pos + 4);
    const body = pos + 8;
    if (id === "fmt " && body + 16 <= b.length) {
      fmt = {
        format: u16le(b, body),
        channels: u16le(b, body + 2),
        rate: u32le(b, body + 4),
        byteRate: u32le(b, body + 8),
        bits: u16le(b, body + 14),
      };
    } else if (id === "data") {
      if (!fmt || fmt.byteRate <= 0) throw new MediaRejected("audio_corrupt");
      const avail = Math.min(size, b.length - body);
      const durationMs = Math.round((avail / fmt.byteRate) * 1000);
      let silent: boolean | null = null;
      if (fmt.format === 1 && (fmt.bits === 16 || fmt.bits === 8)) {
        const dv = new DataView(b.buffer, b.byteOffset + body, avail);
        let peak = 0;
        if (fmt.bits === 16) {
          for (let i = 0; i + 1 < avail; i += 2) peak = Math.max(peak, Math.abs(dv.getInt16(i, true)) / 32768);
        } else {
          for (let i = 0; i < avail; i++) peak = Math.max(peak, Math.abs(dv.getUint8(i) - 128) / 128);
        }
        silent = peak < 0.001; // ≈ -60 dBFS
      }
      return { durationMs, silent };
    }
    pos = body + size + (size % 2);
  }
  throw new MediaRejected("audio_corrupt");
}

// ---------------------------------------------------------------- MP4 / M4A / MOV
interface Mp4Info { durationMs: number; hasAudio: boolean; hasVideo: boolean; width: number; height: number }

function parseMp4(b: Uint8Array): Mp4Info {
  const boxes = (start: number, end: number) => {
    const out: { type: string; body: number; end: number }[] = [];
    let p = start;
    while (p + 8 <= end) {
      let size = u32be(b, p);
      const type = ascii(b, p + 4, 4);
      let hdr = 8;
      if (size === 1) {
        if (p + 16 > end) break;
        size = u32be(b, p + 8) * 2 ** 32 + u32be(b, p + 12);
        hdr = 16;
      } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      out.push({ type, body: p + hdr, end: p + size });
      p += size;
    }
    return out;
  };
  const top = boxes(0, b.length);
  const moov = top.find((x) => x.type === "moov");
  if (!moov) throw new MediaRejected("media_corrupt");
  const inMoov = boxes(moov.body, moov.end);
  const mvhd = inMoov.find((x) => x.type === "mvhd");
  if (!mvhd) throw new MediaRejected("media_corrupt");
  const version = b[mvhd.body]!;
  const mvTimescale = version === 1 ? u32be(b, mvhd.body + 20) : u32be(b, mvhd.body + 12);
  const mvDuration = version === 1 ? u32be(b, mvhd.body + 24) * 2 ** 32 + u32be(b, mvhd.body + 28) : u32be(b, mvhd.body + 16);
  if (!mvTimescale) throw new MediaRejected("media_corrupt");

  let hasAudio = false, hasVideo = false, width = 0, height = 0;
  const trackScale = new Map<number, number>();
  const trackDefaultDur = new Map<number, number>();
  for (const trak of inMoov.filter((x) => x.type === "trak")) {
    const kids = boxes(trak.body, trak.end);
    const tkhd = kids.find((x) => x.type === "tkhd");
    const trackId = tkhd ? u32be(b, tkhd.body + (b[tkhd.body] === 1 ? 20 : 12)) : 0;
    const mdia = kids.find((x) => x.type === "mdia");
    if (!mdia) continue;
    const m = boxes(mdia.body, mdia.end);
    const hdlr = m.find((x) => x.type === "hdlr");
    const mdhd = m.find((x) => x.type === "mdhd");
    if (mdhd) trackScale.set(trackId, b[mdhd.body] === 1 ? u32be(b, mdhd.body + 20) : u32be(b, mdhd.body + 12));
    const handler = hdlr ? ascii(b, hdlr.body + 8, 4) : "";
    if (handler === "soun") hasAudio = true;
    if (handler === "vide") {
      hasVideo = true;
      if (tkhd) {
        const o = tkhd.body + (b[tkhd.body] === 1 ? 88 : 76);
        if (o + 8 <= b.length) { width = u16be(b, o); height = u16be(b, o + 4); }
      }
    }
  }
  const trex = boxes(moov.body, moov.end).find((x) => x.type === "mvex");
  if (trex) for (const t of boxes(trex.body, trex.end).filter((x) => x.type === "trex")) trackDefaultDur.set(u32be(b, t.body + 4), u32be(b, t.body + 12));

  let ms = mvDuration > 0 && mvDuration < 2 ** 48 ? Math.round((mvDuration / mvTimescale) * 1000) : 0;
  // MP4 pecahan (fragmented): durasi di header 0 → jumlahkan sampel di moof/traf/trun per track.
  if (ms === 0 || top.some((x) => x.type === "moof")) {
    const sums = new Map<number, number>();
    for (const moof of top.filter((x) => x.type === "moof")) {
      for (const traf of boxes(moof.body, moof.end).filter((x) => x.type === "traf")) {
        const k = boxes(traf.body, traf.end);
        const tfhd = k.find((x) => x.type === "tfhd");
        if (!tfhd) continue;
        const flags = (b[tfhd.body + 1]! << 16) | (b[tfhd.body + 2]! << 8) | b[tfhd.body + 3]!;
        const id = u32be(b, tfhd.body + 4);
        let q = tfhd.body + 8;
        if (flags & 0x1) q += 8;
        if (flags & 0x2) q += 4;
        let defDur = trackDefaultDur.get(id) ?? 0;
        if (flags & 0x8) { defDur = u32be(b, q); q += 4; }
        for (const trun of k.filter((x) => x.type === "trun")) {
          const f = (b[trun.body + 1]! << 16) | (b[trun.body + 2]! << 8) | b[trun.body + 3]!;
          const n = u32be(b, trun.body + 4);
          let o = trun.body + 8;
          if (f & 0x1) o += 4;
          if (f & 0x4) o += 4;
          let sum = 0;
          for (let i = 0; i < n && o <= trun.end; i++) {
            if (f & 0x100) { sum += u32be(b, o); o += 4; } else sum += defDur;
            if (f & 0x200) o += 4;
            if (f & 0x400) o += 4;
            if (f & 0x800) o += 4;
          }
          sums.set(id, (sums.get(id) ?? 0) + sum);
        }
      }
    }
    let best = 0;
    for (const [id, sum] of sums) { const sc = trackScale.get(id) || 1000; best = Math.max(best, Math.round((sum / sc) * 1000)); }
    if (best > 0) ms = Math.max(ms, best);
  }
  return { durationMs: ms, hasAudio, hasVideo, width, height };
}

// ---------------------------------------------------------------- WebM / Matroska (EBML)
interface WebmInfo { durationMs: number; hasAudio: boolean; hasVideo: boolean; width: number; height: number }

function parseWebm(b: Uint8Array): WebmInfo {
  // ID elemen (disimpan dengan penanda panjangnya) yang dimasuki sebagai kontainer.
  const CONTAINERS = new Set([0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0x1f43b675, 0xa0]);
  let pos = 0;
  const readId = (): number => {
    const first = b[pos]!;
    let len = 1;
    while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 4) throw new MediaRejected("media_corrupt");
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + b[pos + i]!;
    pos += len;
    return v;
  };
  const readSize = (): number => {
    const first = b[pos]!;
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 8) throw new MediaRejected("media_corrupt");
    let v = first & (0xff >> len);
    let allOnes = v === (0xff >> len);
    for (let i = 1; i < len; i++) { v = v * 256 + b[pos + i]!; if (b[pos + i] !== 0xff) allOnes = false; }
    pos += len;
    return allOnes ? -1 : v; // -1 = ukuran tidak diketahui (streaming langsung)
  };
  const uint = (o: number, n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[o + i]!; return v; };

  let timescale = 1_000_000;
  let headerDuration = 0;
  let clusterTime = 0;
  let maxTime = 0;
  let lastBlockStep = 0;
  let hasAudio = false, hasVideo = false, width = 0, height = 0;
  let guard = 0;
  while (pos < b.length - 2 && guard++ < 2_000_000) {
    let id: number, size: number;
    try { id = readId(); size = readSize(); } catch (e) { if (e instanceof MediaRejected) throw e; break; }
    if (CONTAINERS.has(id)) continue; // masuk ke dalam; anak-anaknya dibaca berurutan
    if (size < 0 || pos + size > b.length) { if (id === 0xa3 || id === 0xa1) break; if (size < 0) continue; size = b.length - pos; }
    switch (id) {
      case 0x2ad7b1: timescale = uint(pos, size) || 1_000_000; break;
      case 0x4489: {
        const dv = new DataView(b.buffer, b.byteOffset + pos, size);
        headerDuration = size === 4 ? dv.getFloat32(0) : size === 8 ? dv.getFloat64(0) : 0;
        break;
      }
      case 0x83: { const t = uint(pos, size); if (t === 1) hasVideo = true; else if (t === 2) hasAudio = true; break; }
      case 0xb0: width = uint(pos, size); break;
      case 0xba: height = uint(pos, size); break;
      case 0xe7: clusterTime = uint(pos, size); break;
      case 0xa3: case 0xa1: { // SimpleBlock / Block: nomor track (vint) + timecode relatif int16
        let o = pos;
        const f = b[o]!;
        let l = 1;
        while (l <= 8 && !(f & (0x80 >> (l - 1)))) l++;
        o += l;
        let rel = u16be(b, o);
        if (rel & 0x8000) rel -= 0x10000;
        const t = clusterTime + rel;
        if (t > maxTime) { lastBlockStep = Math.max(lastBlockStep, 0); maxTime = t; }
        break;
      }
      case 0x9b: lastBlockStep = Math.max(lastBlockStep, uint(pos, size)); break; // BlockDuration
    }
    pos += size;
  }
  let ms = 0;
  if (headerDuration > 0) ms = Math.round((headerDuration * timescale) / 1_000_000);
  else if (maxTime > 0) ms = Math.round((maxTime * timescale) / 1_000_000) + (hasVideo ? 34 : 20); // + satu frame terakhir
  return { durationMs: ms, hasAudio, hasVideo, width, height };
}

// ---------------------------------------------------------------- OGG (Opus / Vorbis)
function parseOgg(b: Uint8Array): number {
  // Halaman pertama: header identifikasi.
  if (ascii(b, 0, 4) !== "OggS") throw new MediaRejected("audio_corrupt");
  const nseg = b[26]!;
  const first = 27 + nseg;
  let rate = 0;
  let preSkip = 0;
  if (ascii(b, first, 8) === "OpusHead") {
    rate = 48000;
    preSkip = u16le(b, first + 10);
  } else if (b[first] === 1 && ascii(b, first + 1, 6) === "vorbis") {
    rate = u32le(b, first + 12);
  } else throw new MediaRejected("audio_unsupported");
  if (!rate) throw new MediaRejected("audio_corrupt");

  // Halaman terakhir: granule position.
  let last = -1;
  for (let i = b.length - 14; i >= 0; i--) {
    if (b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53) {
      last = i;
      break;
    }
  }
  if (last < 0) throw new MediaRejected("audio_corrupt");
  const granule = u32le(b, last + 6) + u32le(b, last + 10) * 2 ** 32;
  if (granule <= 0) throw new MediaRejected("audio_corrupt");
  return Math.round(((granule - preSkip) / rate) * 1000);
}

// ---------------------------------------------------------------- MP3
const BITRATES: Record<string, number[]> = {
  // [versi][layer] dalam kbps; indeks 1..14
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

function parseMp3(b: Uint8Array): number {
  let pos = 0;
  if (ascii(b, 0, 3) === "ID3") {
    const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
    pos = 10 + size;
  }
  let totalSamples = 0;
  let frames = 0;
  let sampleRate = 0;
  let firstFrame = true;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff || (b[pos + 1]! & 0xe0) !== 0xe0) {
      if (ascii(b, pos, 3) === "TAG" && b.length - pos === 128) break;
      if (frames === 0) { pos++; continue; } // cari sinkronisasi awal
      pos++;
      continue;
    }
    const vBits = (b[pos + 1]! >> 3) & 3;
    const lBits = (b[pos + 1]! >> 1) & 3;
    const brIdx = (b[pos + 2]! >> 4) & 15;
    const srIdx = (b[pos + 2]! >> 2) & 3;
    const padding = (b[pos + 2]! >> 1) & 1;
    if (vBits === 1 || lBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) { pos++; continue; }
    const version = vBits === 3 ? 1 : vBits === 2 ? 2 : 25;
    const layer = 4 - lBits;
    const brTable = BITRATES[`${version === 1 ? 1 : 2}-${layer}`]!;
    const kbps = brTable[brIdx]!;
    const rate = SAMPLE_RATES[version]![srIdx]!;
    const samplesPerFrame = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;
    const frameLen =
      layer === 1 ? (Math.floor((12 * kbps * 1000) / rate) + padding) * 4
      : Math.floor(((samplesPerFrame / 8) * kbps * 1000) / rate) + padding;
    if (frameLen < 4) { pos++; continue; }
    if (frames === 0) sampleRate = rate;
    // Frame Xing/Info (berisi metadata, bukan audio) tidak dihitung.
    if (firstFrame) {
      firstFrame = false;
      const side = version === 1 ? (b[pos + 3]! >> 6 === 3 ? 17 : 32) : b[pos + 3]! >> 6 === 3 ? 9 : 17;
      const tag = ascii(b, pos + 4 + side, 4);
      if (tag === "Xing" || tag === "Info") { pos += frameLen; continue; }
    }
    frames++;
    totalSamples += samplesPerFrame;
    pos += frameLen;
  }
  if (frames < 2 || !sampleRate) throw new MediaRejected("audio_corrupt");
  return Math.round((totalSamples / sampleRate) * 1000);
}
