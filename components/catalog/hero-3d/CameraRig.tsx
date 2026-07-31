"use client"

import { useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { useScrollProgress } from "@/hooks/useScrollProgress"

/**
 * Rig de cámara controlado por scroll (0..1) con timeline de keyframes:
 *   0.0  → lejos y ligeramente arriba
 *   0.2  → se acerca
 *   0.4  → orbita medio giro
 *   0.6  → sube (más picada, más reflejos)
 *   0.8  → orbita casi vuelta completa
 *   1.0  → close-up frontal
 *
 * Todo es lerp manual: nada de GSAP. `scrub` visual gratis.
 */
type Kf = { t: number; radius: number; height: number; azimuth: number }

const KEYFRAMES: Kf[] = [
  { t: 0.0, radius: 5.8, height: 0.9, azimuth: 0.0 },
  { t: 0.2, radius: 4.9, height: 0.55, azimuth: 0.1 },
  { t: 0.4, radius: 4.4, height: 0.3, azimuth: Math.PI * 0.7 },
  { t: 0.6, radius: 4.0, height: 0.9, azimuth: Math.PI * 1.1 },
  { t: 0.8, radius: 3.6, height: 0.15, azimuth: Math.PI * 1.85 },
  { t: 1.0, radius: 3.2, height: 0.15, azimuth: Math.PI * 2.0 },
]

function sampleTimeline(progress: number): Kf {
  const p = Math.max(0, Math.min(1, progress))
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i]
    const b = KEYFRAMES[i + 1]
    if (p >= a.t && p <= b.t) {
      const span = b.t - a.t
      const u = span === 0 ? 0 : (p - a.t) / span
      // Ease in-out para transición suave entre keys
      const e = u * u * (3 - 2 * u)
      return {
        t: p,
        radius: a.radius + (b.radius - a.radius) * e,
        height: a.height + (b.height - a.height) * e,
        azimuth: a.azimuth + (b.azimuth - a.azimuth) * e,
      }
    }
  }
  return KEYFRAMES[KEYFRAMES.length - 1]
}

interface Props {
  container?: HTMLElement | null
}

export function CameraRig({ container }: Props) {
  const { camera } = useThree()
  const scroll = useScrollProgress(container)
  const target = useRef(new THREE.Vector3(0, -0.15, 0))

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    const p = scroll.current
    const kf = sampleTimeline(p)

    // Flotación de cámara MUY sutil: le da respiración cinemática
    const float = Math.sin(t * 0.35) * 0.05

    const x = Math.sin(kf.azimuth) * kf.radius
    const z = Math.cos(kf.azimuth) * kf.radius

    // Lerp para pulir cualquier salto y suavizar el scrub
    camera.position.x += (x - camera.position.x) * 0.12
    camera.position.y += (kf.height + float - camera.position.y) * 0.12
    camera.position.z += (z - camera.position.z) * 0.12

    camera.lookAt(target.current)
  })

  return null
}
