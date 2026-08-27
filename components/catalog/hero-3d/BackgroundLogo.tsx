"use client"

import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { useGLTF } from "@react-three/drei"
import * as THREE from "three"

/**
 * Copia decorativa del logo GLB usada como capa de fondo de la escena.
 * Va detrás del diamante principal (z lejano + fog + material oscuro y mate),
 * gira despacio y no reacciona al mouse/click — es ambiente, no foco.
 *
 * Se clona la escena cacheada por useGLTF para no colisionar con las
 * mutaciones de material que hace DiamondGLB sobre la misma referencia.
 *
 * Solo se monta cuando hay `modelUrl` — el hero procedural (sin GLB)
 * omite este componente para no cargar nada extra.
 */
export function BackgroundLogo({ modelUrl }: { modelUrl: string }) {
  const { scene } = useGLTF(modelUrl)
  const groupRef = useRef<THREE.Group>(null)

  const cloned = useMemo(() => {
    const s = scene.clone(true)
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#241a08"),
      metalness: 0.85,
      roughness: 0.55,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })
    s.traverse((obj) => {
      const m = obj as THREE.Mesh
      if (m.isMesh) {
        m.material = mat
        m.castShadow = false
        m.receiveShadow = false
      }
    })
    return s
  }, [scene])

  useFrame((_, delta) => {
    const g = groupRef.current
    if (!g) return
    g.rotation.y += delta * 0.04
  })

  return (
    <group
      ref={groupRef}
      position={[0, 0, -6]}
      scale={3.2}
      renderOrder={-1}
    >
      <primitive object={cloned} />
    </group>
  )
}
