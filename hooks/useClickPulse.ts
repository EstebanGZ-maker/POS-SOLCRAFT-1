"use client"

import { useCallback, useRef } from "react"

/**
 * Impulso al hacer clic: setea `active` a 1 y decae exponencialmente.
 * Se consume dentro de `useFrame`: multiplicar por `intensity` para
 * bloom extra, escala, rotación extra, etc.
 *
 * `duration` en segundos. `tick()` debe llamarse cada frame.
 */
export function useClickPulse(duration = 0.9) {
  const active = useRef(0) // 0..1

  const trigger = useCallback(() => {
    active.current = 1
  }, [])

  const tick = useCallback(
    (delta: number) => {
      if (active.current <= 0) return 0
      // Decaimiento exponencial: fuerte al inicio, cae rápido
      active.current = Math.max(0, active.current - delta / duration)
      // Curva más satisfactoria: easeOutCubic sobre lo que queda
      const t = active.current
      return t * t * (3 - 2 * t)
    },
    [duration],
  )

  return { active, trigger, tick }
}
