"use client"

import { useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

/**
 * Iluminación cinematográfica con "breathing":
 *  · key: cálida, arriba-frente (define brillos)
 *  · fill: fría, opuesta (relleno sutil)
 *  · rim: dorada por debajo (borde inferior brillante)
 *  · ambiente muy tenue
 *
 * La intensidad respira sutilmente en el tiempo.
 */
export function Lights() {
  const keyRef = useRef<THREE.DirectionalLight>(null)
  const rimRef = useRef<THREE.PointLight>(null)

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    // Respiración: ±10% alrededor del valor base
    if (keyRef.current) keyRef.current.intensity = 2.6 + Math.sin(t * 0.9) * 0.25
    if (rimRef.current) rimRef.current.intensity = 2.0 + Math.sin(t * 1.3 + 1) * 0.35
  })

  return (
    <>
      <ambientLight intensity={0.35} color="#1a1520" />
      <directionalLight
        ref={keyRef}
        position={[3, 5, 4]}
        intensity={2.6}
        color="#ffd780"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={20}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-bias={-0.0005}
      />
      <directionalLight
        position={[-4, 2, -2]}
        intensity={0.7}
        color="#9ecbff"
      />
      <pointLight
        ref={rimRef}
        position={[-1, 3, -4]}
        intensity={2.0}
        color="#ffeedd"
        distance={12}
      />
      <pointLight
        position={[0, -1.5, 1]}
        intensity={1.2}
        color="#d4a040"
        distance={5}
      />
    </>
  )
}
