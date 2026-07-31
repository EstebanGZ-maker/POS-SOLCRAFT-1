"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { Canvas } from "@react-three/fiber"
import * as THREE from "three"
import { Diamond, DiamondGLB } from "./Diamond"
import { Lights } from "./Lights"
import { HeroEnvironment } from "./Environment"
import { Particles } from "./Particles"
import { CameraRig } from "./CameraRig"
import { Effects } from "./Effects"
import { useClickPulse } from "@/hooks/useClickPulse"

interface Props {
  scrollContainer?: HTMLElement | null
  useGLB?: boolean
}

/**
 * Escena 3D como FONDO FIJO de toda la página.
 *  · position: fixed, inset: 0
 *  · z-index: 0 (contenido va en z ≥ 10)
 *  · pointer-events: none excepto para el clic global que dispara el pulse
 *  · frameloop se pausa cuando el documento deja de ser visible
 */
export function HeroScene({ scrollContainer, useGLB = false }: Props) {
  const [visible, setVisible] = useState(true)
  const [reduced, setReduced] = useState(false)
  const pulse = useClickPulse(0.9)

  // Pausar cuando cambia la visibilidad del documento (pestaña oculta, etc.)
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  // Un clic en cualquier parte de la página dispara el pulse
  useEffect(() => {
    const onClick = () => pulse.trigger()
    window.addEventListener("pointerdown", onClick)
    return () => window.removeEventListener("pointerdown", onClick)
  }, [pulse])

  // DPR conservador en móvil
  const dpr: [number, number] =
    typeof window !== "undefined" && window.innerWidth < 640 ? [1, 1.25] : [1, 1.75]

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 select-none"
      aria-hidden
    >
      {/* Degradado sutil por encima del canvas para asegurar legibilidad
          del contenido en las zonas donde el diamante no está. */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 35%, transparent 0%, hsl(240 23% 3% / 0.55) 70%, hsl(240 23% 3% / 0.85) 100%)",
        }}
      />

      <Canvas
        className="absolute inset-0"
        dpr={dpr}
        frameloop={visible && !reduced ? "always" : "demand"}
        shadows
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.15,
        }}
        camera={{ position: [0, 0.55, 5.8], fov: 40, near: 0.1, far: 50 }}
      >
        <color attach="background" args={["#050508"]} />
        <fog attach="fog" args={["#050508", 6, 16]} />

        <Suspense fallback={null}>
          <HeroEnvironment />
          <Lights />
          <Particles />
          {useGLB ? (
            <DiamondGLB onClickPulse={pulse.trigger} pulse={pulse} />
          ) : (
            <Diamond onClickPulse={pulse.trigger} pulse={pulse} />
          )}
          <CameraRig container={scrollContainer} />
          <Effects />
        </Suspense>
      </Canvas>
    </div>
  )
}
