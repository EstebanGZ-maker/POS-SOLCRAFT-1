"use client"

import { Environment as DreiEnvironment } from "@react-three/drei"

/**
 * HDRI para reflejos PBR realistas del oro.
 * `preset="studio"` viene empacado con Drei — no requiere fetch de HDRI externo,
 * lo cual mantiene el bundle chico y evita depender de una CDN en producción.
 *
 * El environment NO afecta el fondo (background=null) — el negro cinemático
 * lo pone HeroScene con `scene.background`.
 */
export function HeroEnvironment() {
  return <DreiEnvironment preset="studio" background={false} environmentIntensity={1.4} />
}
