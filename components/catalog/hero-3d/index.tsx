"use client"

import dynamic from "next/dynamic"
import { DiamondHero } from "@/components/catalog/diamond-hero"

/**
 * Punto de entrada del hero 3D premium.
 *
 * Se importa con `dynamic({ ssr:false })` para no arrastrar Three.js
 * al bundle inicial y para evitar SSR sobre APIs de WebGL. Mientras
 * carga, se muestra el hero SVG (mismo tamaño, cero CLS).
 *
 * El modelo 3D (.glb) viene por config: cada instancia sube el suyo
 * a `business_settings.catalog_model_url` desde /settings/receipt.
 * Sin URL configurada, HeroScene monta el diamante procedural.
 */
const HeroScene = dynamic(() => import("./HeroScene").then((m) => m.HeroScene), {
  ssr: false,
  loading: () => <DiamondHero />,
})

export function HeroPremium({ modelUrl }: { modelUrl?: string | null }) {
  const url = (modelUrl || "").trim() || null
  return <HeroScene modelUrl={url} />
}
