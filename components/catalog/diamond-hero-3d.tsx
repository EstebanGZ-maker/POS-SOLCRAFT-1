"use client"

/**
 * Diamante 3D con Three.js — versión Taiwy.
 *
 * Portado del motor original (talla brillante Lathe + PMREM env map +
 * shader de destellos) quitando el logo TAIWY hardcodeado.
 * Se carga solo cuando el hero está visible y se congela con
 * `prefers-reduced-motion`. El fallback SVG cubre móvil y GPU débil.
 */

import { useEffect, useRef } from "react"
import * as THREE from "three"

function createDiamondGeometry() {
  // Perfil de una talla brillante rotado 360° con LatheGeometry
  const pts = [
    new THREE.Vector2(0.0, 0.6), // centro de la mesa
    new THREE.Vector2(0.38, 0.6), // borde de la mesa
    new THREE.Vector2(0.42, 0.52), // facetas estrella
    new THREE.Vector2(0.92, 0.22), // corona
    new THREE.Vector2(1.0, 0.15), // filete arriba
    new THREE.Vector2(1.0, 0.1), // filete abajo
    new THREE.Vector2(0.0, -1.45), // culata
  ]
  const geo = new THREE.LatheGeometry(pts, 8)
  geo.computeVertexNormals()
  return geo
}

/** Cubemap procedural cálido para el reflejo dorado */
function buildEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileCubemapShader()

  const envScene = new THREE.Scene()
  envScene.background = new THREE.Color(0x080808)
  envScene.add(new THREE.HemisphereLight(0xffeedd, 0x111111, 2.5))

  const panel = new THREE.PlaneGeometry(8, 8)
  const addPanel = (color: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))
    m.position.set(x, y, z)
    m.lookAt(0, 0, 0)
    envScene.add(m)
  }
  addPanel(0xffd780, 0, 5, 0)
  addPanel(0xfff4e0, 4, 2, 3)
  addPanel(0x3a3a50, -4, 1, -3)
  addPanel(0x1a1a26, 0, -4, 0)

  const envRT = pmrem.fromScene(envScene, 0.02)
  pmrem.dispose()
  envScene.children.forEach((c) => {
    const mesh = c as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
  })
  return envRT.texture
}

/** Sistema de partículas doradas con shader propio */
function createSparkles(count: number) {
  const pos = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const speeds = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 6
    pos[i * 3 + 1] = (Math.random() - 0.5) * 5
    pos[i * 3 + 2] = (Math.random() - 0.5) * 4
    sizes[i] = 0.5 + Math.random() * 1.5
    speeds[i] = 0.3 + Math.random() * 1.2
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    vertexShader: `
      attribute float aSize;
      attribute float aSpeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main(){
        vec3 p = position;
        float t = uTime * aSpeed;
        p.y += sin(t + position.x * 3.0) * 0.15;
        p.x += cos(t * 0.7 + position.z * 2.0) * 0.08;
        vAlpha = (sin(t * 2.5 + position.y * 4.0) * 0.5 + 0.5);
        vAlpha *= vAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * uPixelRatio * (3.0 / -gl_Position.z);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        if(d > 0.5) discard;
        float glow = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(1.0, 0.92, 0.65, vAlpha * glow * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  return { mesh: new THREE.Points(geo, mat), mat }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export default function DiamondHero3D() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    // Respetar accesibilidad: no montar Three.js si el usuario pidió menos motion
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    // La propiedad renombrada en r152+ es outputColorSpace
    ;(renderer as any).outputColorSpace = (THREE as any).SRGBColorSpace ?? "srgb"
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // Fondo transparente: el color de fondo lo pone la landing con el CSS del tema
    scene.background = null

    const cam = new THREE.PerspectiveCamera(
      40,
      container.clientWidth / container.clientHeight,
      0.1,
      80,
    )
    cam.position.set(0, 0.25, 4.6)
    cam.lookAt(0, -0.15, 0)

    const envMap = buildEnvMap(renderer)

    const dmdGeo = createDiamondGeometry()
    const dmdMat = new THREE.MeshStandardMaterial({
      color: 0xdaa520,
      metalness: 0.98,
      roughness: 0.12,
      flatShading: true,
      envMap,
      envMapIntensity: 2.2,
    })
    const diamond = new THREE.Mesh(dmdGeo, dmdMat)
    diamond.scale.setScalar(1.15)

    const wireGeo = createDiamondGeometry()
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    })
    const wireframe = new THREE.Mesh(wireGeo, wireMat)
    wireframe.scale.setScalar(1.155)

    const group = new THREE.Group()
    group.add(diamond)
    group.add(wireframe)
    scene.add(group)

    // Luces
    scene.add(new THREE.AmbientLight(0x1a1520, 0.6))
    const keyLight = new THREE.DirectionalLight(0xffd780, 2.6)
    keyLight.position.set(3, 5, 4)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0x9ecbff, 0.7)
    fillLight.position.set(-4, 2, -2)
    scene.add(fillLight)
    const rimLight = new THREE.PointLight(0xffeedd, 2.0, 12)
    rimLight.position.set(-1, 3, -4)
    scene.add(rimLight)
    const underGlow = new THREE.PointLight(0xd4a040, 1.2, 5)
    underGlow.position.set(0, -1.5, 1)
    scene.add(underGlow)

    const { mesh: sparkMesh, mat: sparkMat } = createSparkles(90)
    scene.add(sparkMesh)

    // Rotación por scroll de la página + inercia
    let targetRot = 0
    let currentRot = 0
    const TOTAL_DEG = 720
    const IDLE_SPEED = 4

    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (max > 0) {
        targetRot = (window.scrollY / max) * TOTAL_DEG * (Math.PI / 180)
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true })

    // Pausar el render cuando el hero no está visible: ahorra CPU/GPU
    let visible = true
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true
      },
      { threshold: 0.01 },
    )
    io.observe(container)

    const clock = new THREE.Clock()
    let rafId = 0
    let idleAcc = 0

    const animate = () => {
      rafId = requestAnimationFrame(animate)
      if (!visible) return
      const dt = clock.getDelta()
      const t = clock.getElapsedTime()

      idleAcc += IDLE_SPEED * dt * (Math.PI / 180)
      const goal = targetRot + idleAcc
      currentRot = lerp(currentRot, goal, 0.06)

      group.rotation.y = currentRot
      group.rotation.x = Math.sin(t * 0.35) * 0.06
      group.position.y = Math.sin(t * 0.55) * 0.08

      sparkMat.uniforms.uTime.value = t

      renderer.render(scene, cam)
    }
    animate()

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      renderer.setSize(w, h)
      cam.aspect = w / h
      cam.updateProjectionMatrix()
      sparkMat.uniforms.uPixelRatio.value = renderer.getPixelRatio()
    })
    ro.observe(container)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener("scroll", onScroll)
      ro.disconnect()
      io.disconnect()
      renderer.dispose()
      dmdGeo.dispose()
      dmdMat.dispose()
      wireGeo.dispose()
      wireMat.dispose()
      sparkMat.dispose()
      sparkMesh.geometry.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div
      ref={mountRef}
      className="mx-auto aspect-square w-full max-w-[480px]"
      aria-hidden
    />
  )
}
