"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./context";
import { Hand } from "../ui/icons";
import { ApiError, keyMessage } from "@/lib/client/api";
import { askHosts, canRecord, hear, record, type Recording } from "@/lib/client/ask";
import { addAsk } from "@/lib/client/store";
import { track } from "@/lib/client/track";
import { stripTags } from "@/lib/tts/tags";
import type { Ask, Episode } from "@/lib/types";

type Phase = "idle" | "pausing" | "listening" | "hearing" | "thinking" | "answering";

export interface RaiseHand {
  phase: Phase;
  /** Questions asked about this episode, the one being answered last. */
  asks: Ask[];
  /** The one being answered right now. */
  current: Ask | null;
  typing: boolean;
  error: string | null;
  ring: React.RefObject<HTMLSpanElement | null>;
  tap: () => void;
  type: (open: boolean) => void;
  submit: (question: string) => void;
}

/**
 * Raise hand. A tap lets the current line finish, pauses, and listens: 1.2 s of quiet (or another
 * tap) sends the question. A long press types it instead. The hosts answer in their own voices,
 * the answer joins the transcript where it was asked, and the episode goes on.
 */
export function useRaiseHand(e: Episode | null, active: number, lineEnd: number): RaiseHand {
  const { settings, aside, T } = useApp();
  const [phase, setPhase] = useState<Phase>("idle");
  const [asks, setAsks] = useState<Ask[]>([]);
  const [current, setCurrent] = useState<Ask | null>(null);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ring = useRef<HTMLSpanElement | null>(null);
  const rec = useRef<Recording | null>(null);
  const stop = useRef<AbortController | null>(null);
  // Whether the episode was playing when the hand went up: it plays again after the answer.
  const resume = useRef(false);
  const k = settings.keys;
  const voice = canRecord() && (k.llmProvider === "hosted" || k.llmProvider === "mock" || Boolean(k.elevenlabsKey));

  // Another episode: its own questions, and nothing of this one carries over.
  useEffect(() => {
    setAsks(e?.asks ?? []);
    return () => {
      stop.current?.abort();
      rec.current?.stop();
      aside.hush();
      setPhase("idle");
      setCurrent(null);
      setTyping(false);
    };
  }, [e?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : undefined;
    setError(
      code === "no_stt" || code === "missing_permissions"
        ? T("这把 ElevenLabs 钥匙不能听写，打字问也一样。", "This ElevenLabs key can't transcribe; typing the question works too.")
        : code?.startsWith("trial")
          ? T("今天的免费额度用完了。", "Today's free allowance is used up.")
          : err instanceof DOMException && err.name === "NotAllowedError"
            ? T("没有麦克风权限，可以打字问。", "No microphone access; you can type the question.")
            : keyMessage((err as Error).message, T),
    );
    if (code === "no_stt" || code === "missing_permissions" || (err instanceof DOMException && err.name === "NotAllowedError")) setTyping(true);
  };

  async function run(typed?: string) {
    if (!e) return;
    setError(null);
    const at = active;
    const ctl = new AbortController();
    stop.current = ctl;
    setPhase("pausing");
    resume.current = await aside.hold(lineEnd);
    try {
      let question = typed?.trim() ?? "";
      let asked = Date.now();
      if (!question) {
        setPhase("listening");
        rec.current = await record((level) => {
          if (ring.current) ring.current.style.opacity = String(0.3 + 0.7 * level);
        });
        const { audio, spoke } = await rec.current.done;
        rec.current = null;
        if (ctl.signal.aborted) return;
        if (!spoke) {
          setPhase("idle");
          aside.release(resume.current);
          return;
        }
        setPhase("hearing");
        asked = Date.now();
        question = await hear(audio, settings);
        if (!question) {
          setError(T("没听清，再问一次？", "Didn't catch that. Ask again?"));
          setPhase("idle");
          aside.release(resume.current);
          return;
        }
      }
      setCurrent({ at, question, lines: [], askedAt: new Date().toISOString() });
      setPhase("thinking");
      let heard = 0;
      const ask = await askHosts(
        e,
        question,
        at,
        settings,
        async (line, bytes) => {
          if (ctl.signal.aborted) return;
          heard ||= Date.now() - asked;
          setPhase("answering");
          setCurrent((c) => c && { ...c, lines: [...c.lines, line] });
          await aside.play(bytes);
        },
        ctl.signal,
      );
      const kept = { ...ask, ms: heard };
      setAsks((a) => [...a, kept]);
      await addAsk(e.id, kept);
      track("ask", { by: typed ? "text" : "voice", ms: heard, lines: kept.lines.length });
    } catch (err) {
      if (!ctl.signal.aborted) {
        fail(err);
        track("ask_fail", { m: (err as Error).message.slice(0, 120) });
      }
    } finally {
      setCurrent(null);
      setPhase("idle");
      if (!ctl.signal.aborted) aside.release(resume.current);
    }
  }

  // A note about what went wrong stays a few seconds, then the bar is clear again.
  useEffect(() => {
    if (!error || typing) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error, typing]);

  return {
    phase,
    asks: current ? [...asks, current] : asks,
    current,
    typing,
    error,
    ring,
    tap: () => {
      if (phase === "listening") return rec.current?.stop();
      if (phase === "thinking" || phase === "answering") {
        // A second tap while they answer: enough, back to the episode.
        stop.current?.abort();
        aside.hush();
        aside.release(resume.current);
        return;
      }
      if (phase !== "idle") return;
      if (!voice) return setTyping(true);
      aside.prime();
      void run();
    },
    type: (open) => {
      setError(null);
      setTyping(open);
    },
    submit: (question) => {
      if (!question.trim() || phase !== "idle") return;
      setTyping(false);
      aside.prime();
      void run(question);
    },
  };
}

/** The round button right of +30: a tap asks out loud, a long press (400 ms) types. */
export function HandButton({ hand }: { hand: RaiseHand }) {
  const { T } = useApp();
  const timer = useRef<number | null>(null);
  const long = useRef(false);
  const busy = hand.phase !== "idle";
  const label =
    hand.phase === "listening"
      ? T("在听，说完停一下就会发出", "Listening; pause when you're done")
      : hand.phase === "thinking" || hand.phase === "answering" || hand.phase === "hearing"
        ? T("停止回答", "Stop the answer")
        : T("举手提问（长按打字）", "Raise hand to ask (hold to type)");
  return (
    <button
      className="hand np-hand"
      aria-label={label}
      title={label}
      aria-pressed={hand.phase === "listening" || hand.phase === "pausing"}
      onPointerDown={() => {
        long.current = false;
        timer.current = window.setTimeout(() => {
          long.current = true;
          if (!busy) hand.type(true);
        }, 400);
      }}
      onPointerUp={() => timer.current && clearTimeout(timer.current)}
      onPointerLeave={() => timer.current && clearTimeout(timer.current)}
      onClick={() => {
        if (long.current) return;
        hand.tap();
      }}
    >
      <span className="hand-ring" ref={hand.ring} />
      <Hand size={24} />
    </button>
  );
}

/** Typing a question: one line above the scrubber. */
export function AskBar({ hand }: { hand: RaiseHand }) {
  const { T } = useApp();
  if (!hand.typing && !hand.error) return null;
  return (
    <div className="ask-bar">
      {hand.typing ? (
        <form
          className="row"
          style={{ flexWrap: "nowrap", gap: 8, width: "100%" }}
          onSubmit={(ev) => {
            ev.preventDefault();
            const input = ev.currentTarget.elements.namedItem("q") as HTMLInputElement;
            hand.submit(input.value);
          }}
        >
          <input name="q" className="field ask-input" autoFocus autoComplete="off" maxLength={300} placeholder={T("问主持人一个问题", "Ask the hosts a question")} onKeyDown={(ev) => ev.key === "Escape" && hand.type(false)} />
          <button className="btn small" type="submit">
            {T("问", "Ask")}
          </button>
        </form>
      ) : (
        <span className="caption">{hand.error}</span>
      )}
    </div>
  );
}

/** A question and its answer, where it was asked in the transcript, indented. */
export function AskBlock({ ask, names, live }: { ask: Ask; names: Record<"A" | "B", string>; live: boolean }) {
  const { T } = useApp();
  return (
    <div className="t-ask" data-ask>
      <div className="t-line t-q">
        <span className="t-who">{T("你问", "You")}</span>
        <span>{ask.question}</span>
      </div>
      {ask.lines.map((l, i) => (
        <div key={i} className={`t-line ${live && i === ask.lines.length - 1 ? "t-now" : "past"}`}>
          <span className="t-who">{names[l.speaker]}</span>
          <span>{stripTags(l.text)}</span>
        </div>
      ))}
      {live && !ask.lines.length && (
        <div className="t-wait caption">
          <span className="breath dim" /> {T("主持人在翻原文", "The hosts are checking the source")}
        </div>
      )}
    </div>
  );
}
