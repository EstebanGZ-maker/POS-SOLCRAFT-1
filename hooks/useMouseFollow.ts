"use client"

import { useEffect, useRef } from "react"

/**
 * Normaliza la posición del mouse en la ventana a [-1, 1] en ambos ejes.
 * Se lee vía ref, sin causar re-renders, para consumir dentro de `useFrame`.
 */
export function useMouseFollow() {
  const ref = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      ref.current.x = (e.clientX / window.innerWidth) * 2 - 1
      ref.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    const onLeave = () => {
      ref.current.x = 0
      ref.current.y = 0
    }
    window.addEventListener("pointermove", onMove, { passive: true })
    window.addEventListener("pointerleave", onLeave)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerleave", onLeave)
    }
  }, [])

  return ref
}
