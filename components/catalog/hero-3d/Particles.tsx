"use client"

import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

interface Props {
  count?: number
}

/**
 * Partículas doradas flotando con shader propio.
 * ShaderMaterial + Points es la forma más barata:
 * ~200 partículas animadas cuestan una llamada de draw.
 */
export function Particles({ count = 160 }: Props) {
  const matRef = useRef<THREE.ShaderMaterial>(null)

  const geo = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const speed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      // Distribuidas en un cubo alrededor del diamante
      pos[i * 3] = (Math.random() - 0.5) * 8
      pos[i * 3 + 1] = (Math.random() - 0.5) * 6
      pos[i * 3 + 2] = (Math.random() - 0.5) * 5
      size[i] = 0.6 + Math.random() * 1.8
      speed[i] = 0.3 + Math.random() * 1.4
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1))
    g.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1))
    return g
  }, [count])

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
          attribute float aSize;
          attribute float aSpeed;
          uniform float uTime;
          uniform float uPixelRatio;
          varying float vAlpha;

          void main() {
            vec3 p = position;
            float t = uTime * aSpeed;
            p.y += sin(t + position.x * 2.5) * 0.20;
            p.x += cos(t * 0.7 + position.z * 2.0) * 0.10;
            vAlpha = sin(t * 2.2 + position.y * 3.5) * 0.5 + 0.5;
            vAlpha *= vAlpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = aSize * uPixelRatio * (3.5 / -gl_Position.z);
          }
        `,
        fragmentShader: `
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            float glow = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(1.0, 0.92, 0.65, vAlpha * glow * 0.85);
          }
        `,
      }),
    [],
  )

  useFrame((state) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.getElapsedTime()
  })

  return <points geometry={geo} material={mat} ref={(m: any) => (matRef.current = m?.material ?? mat)} />
}
