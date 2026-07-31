"use client"

import { useState } from "react"
import Image from "next/image"
import { GlowCard } from "@/components/catalog/glow-card"
import { ImageOff, ChevronLeft, ChevronRight } from "lucide-react"

interface Props {
  images: { url: string; alt: string | null }[]
  productName: string
}

export function ProductGallery({ images, productName }: Props) {
  const [active, setActive] = useState(0)

  if (images.length === 0) {
    return (
      <GlowCard className="aspect-square" intensity={0.28}>
        <div className="flex h-full w-full items-center justify-center">
          <ImageOff className="h-16 w-16 text-[hsl(var(--gold-lo))] opacity-40" />
        </div>
      </GlowCard>
    )
  }

  const current = images[Math.min(active, images.length - 1)]
  const go = (dir: -1 | 1) =>
    setActive((prev) => (prev + dir + images.length) % images.length)

  return (
    <div className="space-y-3">
      <GlowCard className="aspect-square" intensity={0.28}>
        <div className="relative h-full w-full overflow-hidden">
          <Image
            src={current.url}
            alt={current.alt || productName}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />

          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Foto anterior"
                onClick={() => go(-1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-[hsl(var(--gold-mid)/0.4)] bg-[hsl(var(--background)/0.75)] p-2 text-[hsl(var(--gold-mid))] backdrop-blur transition-colors hover:bg-[hsl(var(--background)/0.95)]"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Foto siguiente"
                onClick={() => go(1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-[hsl(var(--gold-mid)/0.4)] bg-[hsl(var(--background)/0.75)] p-2 text-[hsl(var(--gold-mid))] backdrop-blur transition-colors hover:bg-[hsl(var(--background)/0.95)]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[hsl(var(--background)/0.8)] px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground backdrop-blur">
                {active + 1} / {images.length}
              </div>
            </>
          )}
        </div>
      </GlowCard>

      {images.length > 1 && (
        <div className="grid grid-cols-5 gap-2">
          {images.map((img, i) => (
            <button
              key={`${img.url}-${i}`}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Ver foto ${i + 1}`}
              aria-current={i === active}
              className={`relative aspect-square overflow-hidden rounded-lg border transition-colors ${
                i === active
                  ? "border-[hsl(var(--gold-mid))] ring-1 ring-[hsl(var(--gold-mid)/0.5)]"
                  : "border-gold-soft hover:border-gold-strong"
              }`}
            >
              <Image
                src={img.url}
                alt={img.alt || `${productName} — foto ${i + 1}`}
                fill
                sizes="120px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
