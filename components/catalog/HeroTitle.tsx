"use client"

import { useEffect, useRef } from "react"

/**
 * Título del hero con animación:
 *  · Entrada al montar: fade + slide-up + micro-scale (CSS keyframe).
 *  · Ligada al scroll: parallax vertical + fade-out mientras el usuario
 *    hace scroll fuera del hero — el título "flota hacia arriba" y se
 *    desvanece al pasar a las secciones siguientes.
 *  · Respeta prefers-reduced-motion: sin parallax ni entrada.
 */
export function HeroTitle({ text }: { text: string }) {
  const ref = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    let raf = 0
    let entranceDone = false

    const update = () => {
      raf = 0
      if (!entranceDone) return
      const y = window.scrollY
      // Rango de scroll durante el que animamos: primera pantalla del hero.
      const range = Math.max(400, window.innerHeight * 0.7)
      const p = Math.min(1, Math.max(0, y / range))
      const translate = -p * 60
      const opacity = 1 - p * 0.9
      const scale = 1 - p * 0.06
      el.style.transform = `translate3d(0, ${translate}px, 0) scale(${scale})`
      el.style.opacity = String(opacity)
    }

    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(update)
    }

    // El keyframe de entrada domina transform/opacity mientras está activo
    // (fill-mode: both). Al terminar lo quitamos para que el parallax por
    // scroll pueda escribir estilos inline sin que la animación los pise.
    const onAnimEnd = (e: AnimationEvent) => {
      if (e.animationName !== "hero-title-in") return
      entranceDone = true
      el.style.animation = "none"
      update()
    }

    el.addEventListener("animationend", onAnimEnd)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("animationend", onAnimEnd)
      window.removeEventListener("scroll", onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <h1
      ref={ref}
      className="hero-title mt-3 font-display text-5xl leading-[0.95] sm:text-7xl text-gold-gradient will-change-transform"
    >
      {text}
    </h1>
  )
}
