"use client"

import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { useGLTF } from "@react-three/drei"
import * as THREE from "three"
import { useMouseFollow } from "@/hooks/useMouseFollow"
import { useClickPulse } from "@/hooks/useClickPulse"

/**
 * Perfil de una talla brillante. LatheGeometry con MÁS segmentos
 * (48) para que la silueta sea suave, sin las facetas planas evidentes
 * que hacían parecer el diamante translúcido.
 */
function useDiamondGeometry() {
  return useMemo(() => {
    const pts = [
      new THREE.Vector2(0.0, 0.6),
      new THREE.Vector2(0.38, 0.6),
      new THREE.Vector2(0.42, 0.52),
      new THREE.Vector2(0.92, 0.22),
      new THREE.Vector2(1.0, 0.15),
      new THREE.Vector2(1.0, 0.1),
      new THREE.Vector2(0.0, -1.45),
    ]
    // 48 segmentos = superficie suave, evita el "vidrio facetado"
    const geo = new THREE.LatheGeometry(pts, 48)
    geo.computeVertexNormals()
    return geo
  }, [])
}

/**
 * Oro pulido premium: MeshPhysicalMaterial con clearcoat.
 * · metalness 1.0: 100% metálico
 * · roughness 0.08: casi espejo
 * · clearcoat 0.6: la laca superior que da ese "look de joyería"
 * · color más cálido y saturado (menos verdoso que 0xdaa520)
 */
function useGoldMaterial() {
  return useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#e8b64a"),
        metalness: 1.0,
        roughness: 0.08,
        envMapIntensity: 1.85,
        clearcoat: 0.6,
        clearcoatRoughness: 0.1,
      }),
    [],
  )
}

/**
 * Diamante procedural — sin wireframe overlay. La referencia es
 * sólida, no facetada visible: quitar el overlay era el cambio grande.
 */
export function Diamond({
  onClickPulse,
  pulse,
}: {
  onClickPulse: () => void
  pulse: { tick: (dt: number) => number }
}) {
  const groupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const mouseRef = useMouseFollow()
  const geometry = useDiamondGeometry()
  const material = useGoldMaterial()

  const target = useRef({ rotX: 0, rotY: 0, scale: 1, extraRotY: 0 })

  useFrame((state, delta) => {
    const g = groupRef.current
    const m = meshRef.current
    if (!g || !m) return

    const t = state.clock.getElapsedTime()
    const mouse = mouseRef.current

    target.current.extraRotY += 0.15 * delta

    const maxRad = 0.14
    target.current.rotX = mouse.y * maxRad
    target.current.rotY = target.current.extraRotY + mouse.x * maxRad

    const pulseValue = pulse.tick(delta)
    target.current.rotY += pulseValue * Math.PI
    target.current.scale = 1 + pulseValue * 0.15

    g.rotation.x += (target.current.rotX - g.rotation.x) * 0.08
    g.rotation.y += (target.current.rotY - g.rotation.y) * 0.08
    g.position.y = Math.sin(t * 0.55) * 0.08

    const s = target.current.scale
    m.scale.setScalar(m.scale.x + (s - m.scale.x) * 0.15)

    // Emisivo dorado durante el pulse — sin exagerar
    if (pulseValue > 0) {
      material.emissive.setRGB(pulseValue * 0.25, pulseValue * 0.18, pulseValue * 0.06)
      material.emissiveIntensity = 1
    } else if (material.emissiveIntensity !== 0) {
      material.emissiveIntensity = 0
    }
  })

  return (
    <group ref={groupRef} onClick={onClickPulse}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
        scale={1.15}
      />
    </group>
  )
}

/**
 * Variante con GLB cargado. Recibe la URL vía prop (business_settings
 * .catalog_model_url) para que cada instancia sirva su propio modelo
 * desde Storage. Sin URL, HeroScene renderiza `Diamond` procedural y
 * no monta este componente.
 */
export function DiamondGLB({
  modelUrl,
  onClickPulse,
  pulse,
}: {
  modelUrl: string
  onClickPulse: () => void
  pulse: { tick: (dt: number) => number }
}) {
  const { scene } = useGLTF(modelUrl)
  const groupRef = useRef<THREE.Group>(null)
  const material = useGoldMaterial()
  const mouseRef = useMouseFollow()
  const target = useRef({ rotX: 0, rotY: 0, scale: 1, extraRotY: 0 })

  useMemo(() => {
    scene.traverse((obj) => {
      const m = obj as THREE.Mesh
      if (m.isMesh) {
        m.material = material
        m.castShadow = true
        m.receiveShadow = true
      }
    })
  }, [scene, material])

  useFrame((state, delta) => {
    const g = groupRef.current
    if (!g) return
    const mouse = mouseRef.current
    target.current.extraRotY += 0.15 * delta
    target.current.rotX = mouse.y * 0.14
    target.current.rotY = target.current.extraRotY + mouse.x * 0.14

    const pulseValue = pulse.tick(delta)
    target.current.rotY += pulseValue * Math.PI
    target.current.scale = 1 + pulseValue * 0.15

    g.rotation.x += (target.current.rotX - g.rotation.x) * 0.08
    g.rotation.y += (target.current.rotY - g.rotation.y) * 0.08
    g.position.y = Math.sin(state.clock.getElapsedTime() * 0.55) * 0.08
    g.scale.setScalar(g.scale.x + (target.current.scale - g.scale.x) * 0.15)
  })

  return (
    <group ref={groupRef} onClick={onClickPulse}>
      <primitive object={scene} />
    </group>
  )
}
