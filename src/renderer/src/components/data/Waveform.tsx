import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn, formatDuration } from '@/lib/utils';

/**
 * Waveform (§5.1) — l'elemento identitario del prodotto.
 *
 * L'envelope RMS arriva dal sidecar (max ~480 bucket: non sono campioni audio)
 * e viene disegnato su canvas, così il ridisegno durante il trascinamento non
 * costa nulla. Sopra ci stanno tre livelli di informazione:
 *   - le bande di struttura (intro/build/drop/breakdown/outro), quando note;
 *   - la griglia dei beat a due densità: battuta ogni 4, frase ogni 32 — le
 *     linee di frase sono quelle su cui un DJ mette davvero i cue, e infatti
 *     hanno più contrasto;
 *   - i marker dei cue, trascinabili con pointer capture (il drag sopravvive
 *     all'uscita dall'elemento) e con snap opzionale a una battuta.
 *
 * Nessuna riproduzione audio: è una scelta di prodotto, non una mancanza.
 * L'ascolto resta in Rekordbox; qui il posizionamento deve essere preciso.
 */

export interface WaveCue {
  label: string;
  positionMs: number;
  color: string | null;
}

export interface WaveBand {
  label: string;
  fromMs: number;
  toMs: number;
  color: string;
}

const H = 132;
const RULER = 20;

export function Waveform({
  envelope,
  durationS,
  cues,
  bands,
  bpm,
  snapToBar = false,
  onMoveCue,
  className
}: {
  envelope: number[];
  durationS: number;
  cues: WaveCue[];
  bands?: WaveBand[];
  bpm?: number | null;
  snapToBar?: boolean;
  onMoveCue?: (index: number, positionMs: number) => void;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const durationMs = durationS * 1000;

  const draw = useCallback(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box || !envelope.length || durationMs <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = box.clientWidth;
    const h = H - RULER;
    el.width = Math.max(1, Math.floor(w * dpr));
    el.height = Math.max(1, Math.floor(h * dpr));
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;

    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.documentElement);
    const rgb = (name: string, alpha = 1) => {
      const raw = css.getPropertyValue(name).trim() || '120 120 120';
      return `rgb(${raw.split(/\s+/).join(' ')} / ${alpha})`;
    };

    // bande di struttura
    for (const b of bands ?? []) {
      const x0 = (b.fromMs / durationMs) * w;
      const x1 = (b.toMs / durationMs) * w;
      ctx.fillStyle = `${b.color}1F`;
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }

    // griglia beat: battuta (4 beat) tenue, frase (32 beat) più marcata
    if (bpm && bpm > 0) {
      const beatMs = 60000 / bpm;
      const barMs = beatMs * 4;
      const phraseMs = beatMs * 32;
      if (barMs > 0 && durationMs / barMs < 2000) {
        ctx.lineWidth = 1;
        for (let t = 0; t <= durationMs; t += barMs) {
          const x = Math.round((t / durationMs) * w) + 0.5;
          const phrase = Math.abs(t % phraseMs) < 1;
          ctx.strokeStyle = phrase ? rgb('--line-strong', 0.85) : rgb('--line', 0.4);
          ctx.beginPath();
          ctx.moveTo(x, phrase ? 0 : h * 0.18);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      }
    }

    // envelope speculare
    const mid = h / 2;
    const barW = Math.max(1, w / envelope.length);
    ctx.fillStyle = rgb('--accent', 0.55);
    for (let i = 0; i < envelope.length; i++) {
      const v = Math.max(0, Math.min(1, envelope[i]));
      const bh = Math.max(1, v * (mid - 3));
      ctx.fillRect(i * (w / envelope.length), mid - bh, Math.max(0.7, barW - 0.3), bh * 2);
    }

    ctx.strokeStyle = rgb('--line', 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(mid) + 0.5);
    ctx.lineTo(w, Math.round(mid) + 0.5);
    ctx.stroke();
  }, [envelope, durationMs, bands, bpm]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [draw]);

  const xToMs = useCallback(
    (clientX: number): number => {
      const rect = wrap.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      let ms = Math.round(frac * durationMs);
      if (snapToBar && bpm && bpm > 0) {
        const barMs = (60000 / bpm) * 4;
        ms = Math.round(ms / barMs) * barMs;
      }
      return Math.min(durationMs, Math.max(0, ms));
    },
    [durationMs, snapToBar, bpm]
  );

  if (!envelope.length || durationMs <= 0) return null;

  const ticks = Array.from({ length: 8 }, (_, i) => (durationS / 8) * i);

  return (
    <div
      ref={wrap}
      className={cn(
        'relative select-none overflow-hidden rounded-card border border-line bg-surface-1',
        className
      )}
      style={{ height: H }}
      onPointerMove={(e) => {
        setHoverMs(xToMs(e.clientX));
        if (drag !== null && onMoveCue) onMoveCue(drag, xToMs(e.clientX));
      }}
      onPointerLeave={() => {
        setHoverMs(null);
        setDrag(null);
      }}
      onPointerUp={(e) => {
        if (drag !== null) {
          (e.target as Element).releasePointerCapture?.(e.pointerId);
          setDrag(null);
        }
      }}
    >
      <canvas ref={canvas} className="block" />

      {/* linea di hover con timecode */}
      {hoverMs !== null && drag === null && (
        <div
          className="pointer-events-none absolute top-0 w-px bg-ink-lo/60"
          style={{ left: `${(hoverMs / durationMs) * 100}%`, height: H - RULER }}
        >
          <span className="absolute -top-0 left-1 rounded-[3px] bg-surface-2/90 px-1 font-mono text-[9px] tabular-nums text-ink-mid">
            {formatDuration(hoverMs / 1000)}
          </span>
        </div>
      )}

      {/* marker dei cue */}
      {cues.map((c, i) => {
        const left = Math.min(100, Math.max(0, (c.positionMs / durationMs) * 100));
        const color = c.color ?? '#8A9099';
        const dragging = drag === i;
        return (
          <div
            key={i}
            className="absolute top-0 touch-none"
            style={{ left: `${left}%`, height: H - RULER, cursor: onMoveCue ? 'ew-resize' : 'default' }}
            onPointerDown={(e) => {
              if (!onMoveCue) return;
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDrag(i);
            }}
          >
            <div
              className="absolute inset-y-0 -left-1 w-2"
              aria-hidden
            />
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: dragging ? 2 : 1.5, background: color }}
            />
            <span
              className="absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-r-[4px] border px-1.5 py-0.5"
              style={{
                background: dragging ? color : `${color}26`,
                borderColor: color,
                color: dragging ? '#0A0B0D' : color
              }}
            >
              <span className="font-mono text-[9px] font-bold uppercase tracking-[.08em]">
                {c.label}
              </span>
              <span className="font-mono text-[9px] tabular-nums opacity-80">
                {formatDuration(c.positionMs / 1000)}
              </span>
            </span>
          </div>
        );
      })}

      {/* righello */}
      <div
        className="absolute inset-x-0 bottom-0 flex border-t border-line-subtle bg-canvas"
        style={{ height: RULER }}
      >
        {ticks.map((s, i) => (
          <span
            key={i}
            className="flex-1 pl-1.5 pt-1 font-mono text-[9px] tabular-nums text-ink-lo"
          >
            {formatDuration(s)}
          </span>
        ))}
      </div>
    </div>
  );
}
