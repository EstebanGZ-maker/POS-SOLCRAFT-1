"use client"

import { useEffect, useRef } from "react"

/**
 * Devuelve una ref con el progreso del scroll del contenedor observado
 * (0 = arriba, 1 = abajo del todo). Actualiza vía rAF para no saturar.
 * Se lee dentro de `useFrame`, sin re-render.
 */
export function useScrollProgress(target?: HTMLElement | null) {
  const ref = useRef(0)

  useEffect(() => {
    let raf = 0
    const el = target ?? null

    const compute = () => {
      if (el) {
        const rect = el.getBoundingClientRect()
        const total = rect.height - window.innerHeight
        if (total <= 0) {
          ref.current = 0
        } else {
          const scrolled = -rect.top
          ref.current = Math.max(0, Math.min(1, scrolled / total))
        }
      } else {
        const total = document.documentElement.scrollHeight - window.innerHeight
        ref.current = total > 0 ? Math.max(0, Math.min(1, window.scrollY / total)) : 0
      }
    }

    let pending = false
    const onScroll = () => {
      if (pending) return
      pending = true
      raf = requestAnimationFrame(() => {
        compute()
        pending = false
      })
    }

    compute()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [target])

  return ref
}
