"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Diamante de talla brillante en SVG puro — sin dependencias.
 * Las facetas se iluminan de forma independiente para simular la rotación,
 * y el brillo sigue el scroll. Se congela con prefers-reduced-motion.
 */
export function DiamondHero() {
  const [t, setT] = useState(0)
  const [reduced, setReduced] = useState(false)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  useEffect(() => {
    if (reduced) return
    let start: number | null = null
    const loop = (ts: number) => {
      if (start === null) start = ts
      setT((ts - start) / 1000)
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [reduced])

  // Brillo cíclico por faceta — desfasado para dar sensación de giro
  const shine = (offset: number) => {
    if (reduced) return 0.55
    return 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.1 + offset))
  }

  // Facetas de la corona (arriba) y del pabellón (abajo)
  const crown = [
    { d: "M100 42 L58 76 L100 76 Z", o: 0 },
    { d: "M100 42 L142 76 L100 76 Z", o: 1.1 },
    { d: "M100 42 L58 76 L30 76 L58 58 Z", o: 2.2 },
    { d: "M100 42 L142 76 L170 76 L142 58 Z", o: 3.3 },
  ]
  const pavilion = [
    { d: "M30 76 L100 76 L100 170 Z", o: 0.6 },
    { d: "M170 76 L100 76 L100 170 Z", o: 1.7 },
    { d: "M58 76 L100 76 L100 170 Z", o: 2.8 },
    { d: "M142 76 L100 76 L100 170 Z", o: 3.9 },
  ]

  return (
    <div className="relative mx-auto w-full max-w-[420px] select-none" aria-hidden>
      <svg viewBox="0 0 200 190" className="w-full drop-shadow-[0_0_50px_hsl(var(--gold-mid)/0.35)]">
        <defs>
          <linearGradient id="dh-table" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--gold-hi))" />
            <stop offset="60%" stopColor="hsl(var(--gold-mid))" />
            <stop offset="100%" stopColor="hsl(var(--gold-lo))" />
          </linearGradient>
          <linearGradient id="dh-facet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--gold-hi))" />
            <stop offset="100%" stopColor="hsl(var(--gold-lo))" />
          </linearGradient>
          <radialGradient id="dh-halo">
            <stop offset="0%" stopColor="hsl(var(--gold-mid))" stopOpacity=".35" />
            <stop offset="100%" stopColor="hsl(var(--gold-mid))" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Halo */}
        <ellipse cx="100" cy="95" rx="98" ry="92" fill="url(#dh-halo)" />

        {/* Mesa superior */}
        <polygon points="58,42 142,42 170,76 30,76" fill="url(#dh-table)" opacity={0.9} />
        <polygon points="58,42 142,42 142,58 58,58" fill="hsl(var(--gold-hi))" opacity={shine(0.4) * 0.5} />

        {/* Corona */}
        {crown.map((f, i) => (
          <path key={`c${i}`} d={f.d} fill="url(#dh-facet)" opacity={shine(f.o)} />
        ))}

        {/* Pabellón */}
        {pavilion.map((f, i) => (
          <path key={`p${i}`} d={f.d} fill="url(#dh-facet)" opacity={shine(f.o) * 0.8} />
        ))}

        {/* Aristas */}
        <g stroke="hsl(var(--gold-hi))" strokeWidth="0.6" fill="none" opacity=".45">
          <polygon points="58,42 142,42 170,76 100,170 30,76" />
          <path d="M30 76 H170 M58 42 L58 76 M142 42 L142 76 M100 42 L100 76" />
        </g>

        {/* Destellos */}
        {!reduced &&
          [
            { x: 44, y: 60, o: 0 },
            { x: 158, y: 64, o: 1.9 },
            { x: 100, y: 150, o: 3.1 },
            { x: 72, y: 100, o: 4.4 },
          ].map((s, i) => {
            const a = Math.max(0, Math.sin(t * 2.2 + s.o))
            return (
              <g key={`s${i}`} opacity={a}>
                <path
                  d={`M${s.x} ${s.y - 7} L${s.x + 1.6} ${s.y - 1.6} L${s.x + 7} ${s.y} L${s.x + 1.6} ${s.y + 1.6} L${s.x} ${s.y + 7} L${s.x - 1.6} ${s.y + 1.6} L${s.x - 7} ${s.y} L${s.x - 1.6} ${s.y - 1.6} Z`}
                  fill="hsl(var(--gold-hi))"
                />
              </g>
            )
          })}
      </svg>
    </div>
  )
}
