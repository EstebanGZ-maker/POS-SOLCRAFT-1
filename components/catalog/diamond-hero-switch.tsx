"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { DiamondHero } from "./diamond-hero"

/**
 * Diamante 3D con Three.js, cargado solo en cliente para no arrastrar
 * ~150 KB al bundle inicial. Fallback al SVG mientras carga.
 */
const DiamondHero3D = dynamic(() => import("./diamond-hero-3d"), {
  ssr: false,
  loading: () => <DiamondHero />,
})

/**
 * Decide qué versión usar:
 *  · Móvil (< 640 px) → SVG. Three.js consume batería y no compensa en pantallas pequeñas.
 *  · prefers-reduced-motion → SVG. El motor 3D lo respeta también, pero es más limpio no cargarlo.
 *  · Sin WebGL disponible → SVG.
 *  · Resto → Three.js.
 */
export function DiamondHeroSwitch() {
  const [use3D, setUse3D] = useState(false)
  const [decided, setDecided] = useState(false)

  useEffect(() => {
    const decide = () => {
      const smallScreen = window.matchMedia("(max-width: 639px)").matches
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      if (smallScreen || reducedMotion) {
        setUse3D(false)
        setDecided(true)
        return
      }
      // Probar WebGL una sola vez
      let hasWebGL = false
      try {
        const c = document.createElement("canvas")
        hasWebGL = Boolean(c.getContext("webgl2") || c.getContext("webgl"))
      } catch {
        hasWebGL = false
      }
      setUse3D(hasWebGL)
      setDecided(true)
    }
    decide()
  }, [])

  // Mientras se decide, se muestra el SVG (que es lo más ligero).
  // Evita CLS: ambos componentes tienen la misma caja.
  if (!decided || !use3D) return <DiamondHero />

  return <DiamondHero3D />
}
