"use client"

import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing"
import { BlendFunction } from "postprocessing"

/**
 * Post: bloom controlado (no explota los blancos) + vignette suave.
 * Sin SSAO ni DOF: mantenemos el bundle acotado y el FPS alto en móvil.
 */
export function Effects() {
  return (
    <EffectComposer multisampling={0}>
      {/* Bloom sutil: solo los reflejos más brillantes explotan.
          Un diamante sólido pulido tiene brillos puntuales, no un halo permanente. */}
      <Bloom
        intensity={0.55}
        luminanceThreshold={0.65}
        luminanceSmoothing={0.5}
        mipmapBlur
        radius={0.6}
      />
      <Vignette
        eskil={false}
        offset={0.25}
        darkness={0.8}
        blendFunction={BlendFunction.NORMAL}
      />
    </EffectComposer>
  )
}
