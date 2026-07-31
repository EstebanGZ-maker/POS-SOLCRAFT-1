"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Hero del catálogo: logo TW dorado con transformación 3D CSS.
 *
 * · Rotación por scroll con inercia (lerp)
 * · Impulso al hacer clic
 * · Tilt sutil siguiendo el mouse
 * · Halo dorado detrás
 * · Respeta prefers-reduced-motion (queda estático con perspectiva)
 *
 * La imagen es un render 3D con iluminación propia — no la re-iluminamos:
 * solo la transformamos como plano en el espacio 3D.
 */

const IDLE_SPEED_DEG_PER_SEC = 6
const SCROLL_TURN_DEG = 540 // vueltas al recorrer la página
const CLICK_IMPULSE_DEG = 180
const MAX_TILT_X_DEG = 12
const LERP = 0.08

export function HeroLogo3D() {
  const shellRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef({
    currentY: 0, targetY: 0, // rotación acumulada horizontal
    tiltX: 0, targetTiltX: 0, // inclinación vertical por mouse
    idleAcc: 0,
    lastTs: 0,
    impulse: 0,
    visible: true,
    reduced: false,
  })
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const shell = shellRef.current
    const card = cardRef.current
    if (!shell || !card) return

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    stateRef.current.reduced = mq.matches
    setReduced(mq.matches)
    const onMotionChange = () => {
      stateRef.current.reduced = mq.matches
      setReduced(mq.matches)
    }
    mq.addEventListener("change", onMotionChange)

    // Pausar el loop cuando el hero sale de vista
    const io = new IntersectionObserver(
      (entries) => {
        stateRef.current.visible = entries[0]?.isIntersecting ?? true
      },
      { threshold: 0.05 },
    )
    io.observe(shell)

    // Scroll de la página → rotación horizontal
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      stateRef.current.targetY =
        max > 0 ? (window.scrollY / max) * SCROLL_TURN_DEG : 0
    }
    window.addEventListener("scroll", onScroll, { passive: true })

    // Mouse en el card → tilt vertical
    const onMouseMove = (e: MouseEvent) => {
      if (stateRef.current.reduced) return
      const r = card.getBoundingClientRect()
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
      stateRef.current.targetTiltX = Math.max(-1, Math.min(1, dy)) * -MAX_TILT_X_DEG
    }
    const onMouseLeave = () => {
      stateRef.current.targetTiltX = 0
    }
    card.addEventListener("mousemove", onMouseMove)
    card.addEventListener("mouseleave", onMouseLeave)

    // Clic → impulso de rotación
    const onClick = () => {
      stateRef.current.impulse += CLICK_IMPULSE_DEG
    }
    card.addEventListener("click", onClick)

    // Bucle de animación
    let raf = 0
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick)
      const s = stateRef.current
      if (!s.visible) return

      const dt = s.lastTs ? Math.min((ts - s.lastTs) / 1000, 0.05) : 0
      s.lastTs = ts

      if (!s.reduced) {
        s.idleAcc += IDLE_SPEED_DEG_PER_SEC * dt
      }

      // Consumir el impulso poco a poco: no que salte, que gire con inercia
      if (s.impulse !== 0) {
        const step = Math.sign(s.impulse) * Math.min(Math.abs(s.impulse), 6)
        s.idleAcc += step
        s.impulse -= step
      }

      const goalY = s.targetY + s.idleAcc
      s.currentY += (goalY - s.currentY) * LERP
      s.tiltX += (s.targetTiltX - s.tiltX) * LERP

      card.style.transform =
        `rotateX(${s.tiltX.toFixed(2)}deg) rotateY(${s.currentY.toFixed(2)}deg)`
    }
    raf = requestAnimationFrame(tick)

    // Estado inicial
    onScroll()

    return () => {
      cancelAnimationFrame(raf)
      mq.removeEventListener("change", onMotionChange)
      io.disconnect()
      window.removeEventListener("scroll", onScroll)
      card.removeEventListener("mousemove", onMouseMove)
      card.removeEventListener("mouseleave", onMouseLeave)
      card.removeEventListener("click", onClick)
    }
  }, [])

  return (
    <div
      ref={shellRef}
      className="relative mx-auto aspect-square w-full max-w-[480px]"
      style={{ perspective: "1200px" }}
    >
      {/* Halo dorado detrás */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          background:
            "radial-gradient(closest-side, hsl(var(--gold-mid) / 0.35), transparent 70%)",
          filter: "blur(20px)",
        }}
      />

      <div
        ref={cardRef}
        className="relative h-full w-full cursor-pointer select-none will-change-transform"
        style={{
          transformStyle: "preserve-3d",
          transition: reduced ? "none" : undefined,
        }}
        role="img"
        aria-label="Logo SOLCRAFT en 3D — haz clic para girar"
        title="Haz clic para girar"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hero-logo.png"
          alt=""
          draggable={false}
          className="pointer-events-none h-full w-full object-contain drop-shadow-[0_20px_35px_hsl(var(--gold-dk)/0.55)]"
          style={{ backfaceVisibility: "visible" }}
        />
      </div>
    </div>
  )
}
