"use client";

/** Seconds of audio kept appended ahead of the playhead; the rest waits in memory (browsers cap audio buffers at ~12 MB). */
const AHEAD = 180;
/** Seconds of played audio kept behind the playhead for jumping back. */
const BEHIND = 300;

type MediaSourceCtor = typeof MediaSource;

function ctor(): MediaSourceCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { ManagedMediaSource?: MediaSourceCtor };
  return w.ManagedMediaSource ?? (typeof MediaSource === "undefined" ? null : MediaSource);
}

/**
 * Plays an episode while it is still being voiced: MP3 chunks are appended to a MediaSource as they
 * arrive, so listening starts after the first chapter. Playback simply waits at the edge if
 * voicing falls behind, and the stream closes once the last chapter is in.
 */
export class LiveAudio {
  readonly url: string;
  private ms: MediaSource;
  private sb: SourceBuffer | null = null;
  private queue: Uint8Array[] = [];
  private closing = false;
  private appended = 0;
  /** Seconds appended or queued, as the chunks were measured when they arrived. */
  queuedSec = 0;

  static supported(): boolean {
    const MS = ctor();
    return Boolean(MS?.isTypeSupported?.("audio/mpeg"));
  }

  constructor(private el: HTMLAudioElement) {
    const MS = ctor()!;
    this.ms = new MS();
    this.url = URL.createObjectURL(this.ms);
    this.ms.addEventListener(
      "sourceopen",
      () => {
        this.sb = this.ms.addSourceBuffer("audio/mpeg");
        // MP3 carries no timestamps: each chunk plays right after the last.
        this.sb.mode = "sequence";
        this.sb.addEventListener("updateend", this.pump);
        this.pump();
      },
      { once: true },
    );
    // Safari's managed source needs this to play through MediaSource at all.
    (el as HTMLAudioElement & { disableRemotePlayback: boolean }).disableRemotePlayback = true;
    el.addEventListener("timeupdate", this.pump);
    el.src = this.url;
  }

  append(bytes: Uint8Array, seconds: number) {
    this.queue.push(bytes);
    this.queuedSec += seconds;
    this.pump();
  }

  /** No more chunks: the stream ends once the queue drains. */
  end() {
    this.closing = true;
    this.pump();
  }

  /** Whether `t` can be played from what is in the buffer now. */
  has(t: number): boolean {
    const b = this.sb?.buffered;
    if (!b) return false;
    for (let i = 0; i < b.length; i++) if (t >= b.start(i) && t <= b.end(i)) return true;
    return false;
  }

  /** The latest second playable right now. */
  get edge(): number {
    const b = this.sb?.buffered;
    return b && b.length ? b.end(b.length - 1) : 0;
  }

  detach() {
    this.el.removeEventListener("timeupdate", this.pump);
    this.queue = [];
    URL.revokeObjectURL(this.url);
  }

  private pump = () => {
    const sb = this.sb;
    if (!sb || sb.updating || this.ms.readyState !== "open") return;
    const now = this.el.currentTime;
    const b = sb.buffered;
    // Drop what was heard long ago, so a 30-minute episode never hits the buffer cap.
    if (b.length && now - b.start(0) > BEHIND + 30) {
      sb.remove(b.start(0), now - BEHIND);
      return;
    }
    if (this.queue.length && (this.edge - now < AHEAD || this.appended === 0)) {
      const next = this.queue.shift()!;
      try {
        sb.appendBuffer(next as BufferSource);
        this.appended++;
      } catch (e) {
        // Full: put it back and try again once playback has moved on.
        if ((e as DOMException).name === "QuotaExceededError") this.queue.unshift(next);
        else throw e;
      }
      return;
    }
    if (!this.queue.length && this.closing) this.ms.endOfStream();
  };
}

/**
 * Live playback for browsers that can't stream MP3 into a MediaSource (iPhones before iOS 17.1,
 * some others): what has been voiced plays as one file, and shortly before playback reaches its end
 * the file is rebuilt with everything voiced since and resumed at the same moment. A brief seam now
 * and then, instead of waiting for the whole episode.
 */
export class FileAudio {
  private parts: Uint8Array[] = [];
  private secs = 0;
  private loaded = { parts: 0, secs: 0 };
  private url: string | null = null;
  private swapping = false;
  /** Playing, or meant to be: it starts on its own, and a rebuild keeps playing what was playing. */
  private wanted = true;
  queuedSec = 0;

  constructor(private el: HTMLAudioElement) {
    el.addEventListener("timeupdate", this.check);
    el.addEventListener("ended", this.check);
    el.addEventListener("pause", this.onPause);
    el.addEventListener("play", this.onPlay);
  }

  append(bytes: Uint8Array, seconds: number) {
    this.parts.push(bytes);
    this.secs += seconds;
    this.queuedSec = this.secs;
    if (!this.loaded.parts) this.load();
    else this.check();
  }

  end() {
    this.check();
  }

  has(t: number): boolean {
    return t <= this.loaded.secs;
  }

  get edge(): number {
    return this.loaded.secs;
  }

  detach() {
    this.el.removeEventListener("timeupdate", this.check);
    this.el.removeEventListener("ended", this.check);
    this.el.removeEventListener("pause", this.onPause);
    this.el.removeEventListener("play", this.onPlay);
    if (this.url) URL.revokeObjectURL(this.url);
    this.parts = [];
  }

  // A pause at the end of the file is the file running out, not the listener.
  private onPause = () => {
    if (!this.swapping && !this.el.ended) this.wanted = false;
  };
  private onPlay = () => {
    this.wanted = true;
  };

  private check = () => {
    if (this.swapping || this.loaded.parts === this.parts.length) return;
    if (this.el.ended || this.loaded.secs - this.el.currentTime < 2.5) this.load();
  };

  private load() {
    this.swapping = true;
    const at = this.el.ended ? this.loaded.secs : this.el.currentTime;
    const old = this.url;
    this.url = URL.createObjectURL(new Blob(this.parts as BlobPart[], { type: "audio/mpeg" }));
    this.loaded = { parts: this.parts.length, secs: this.secs };
    this.el.addEventListener(
      "loadedmetadata",
      () => {
        if (at > 0) this.el.currentTime = Math.min(at, this.el.duration || at);
        if (this.wanted) this.el.play().catch(() => undefined);
        if (old) URL.revokeObjectURL(old);
        this.swapping = false;
        this.check();
      },
      { once: true },
    );
    this.el.src = this.url;
  }
}

export type LiveStream = LiveAudio | FileAudio;

/** The best way this browser can play an episode while it is still being voiced. */
export const liveStream = (el: HTMLAudioElement): LiveStream => (LiveAudio.supported() ? new LiveAudio(el) : new FileAudio(el));
