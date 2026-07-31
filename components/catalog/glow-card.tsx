"use client"

import { useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Tarjeta con resplandor dorado que sigue el cursor.
 * El efecto se desactiva solo si el usuario pidió menos movimiento
 * o si el dispositivo no tiene puntero fino (móvil).
 */
export function GlowCard({
  children,
  className,
  intensity = 0.5,
}: {
  children: ReactNode
  className?: string
  intensity?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={() => setPos(null)}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-gold-soft",
        "surface-gold transition-all duration-300",
        "hover:border-gold-strong hover:-translate-y-0.5 hover:glow-gold",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      {/* Halo que sigue al cursor */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:hidden"
        style={
          pos
            ? {
                background: `radial-gradient(340px circle at ${pos.x}px ${pos.y}px, hsl(var(--gold-mid) / ${intensity}), transparent 65%)`,
              }
            : undefined
        }
      />
      {/* Filo superior dorado */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--gold-mid)/0.7)] to-transparent opacity-60"
      />
      {/* h-full para que el contenido pueda ocupar toda la tarjeta:
          sin esto, un hijo con `h-full` o una imagen `fill` mide 0. */}
      <div className="relative h-full">{children}</div>
    </div>
  )
}
