"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { DiamondHero } from "@/components/catalog/diamond-hero"

/**
 * Punto de entrada del hero 3D premium.
 * Se importa con `dynamic({ ssr:false })` para no arrastrar Three.js
 * al bundle inicial y para evitar SSR sobre APIs de WebGL.
 * Mientras carga, se muestra el hero SVG (mismo tamaño, cero CLS).
 */
const HeroScene = dynamic(() => import("./HeroScene").then((m) => m.HeroScene), {
  ssr: false,
  loading: () => <DiamondHero />,
})

export function HeroPremium() {
  const [glbAvailable, setGlbAvailable] = useState<boolean | null>(null)

  // Detectar si el .glb del logo TW está presente. Si no, usa el diamante
  // procedural (visualmente equivalente hasta que aportes el modelo).
  useEffect(() => {
    let cancelled = false
    fetch("/hero-logo.glb", { method: "HEAD" })
      .then((r) => {
        if (!cancelled) setGlbAvailable(r.ok)
      })
      .catch(() => {
        if (!cancelled) setGlbAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Mientras decide, no importa: HeroScene por dentro elige lo mismo
  return <HeroScene useGLB={glbAvailable === true} />
}
