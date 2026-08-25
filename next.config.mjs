/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      // Default de Next.js es 1 MB. uploadProductMedia recibe fotos/videos
      // codificados en base64 (~4/3 del tamaño real). Con MAX_IMAGE_BYTES
      // interno = 5 MB, el body puede llegar a ~6.7 MB. 20 MB deja margen
      // seguro y mantiene el 413 lejos del flujo real; validación fina de
      // tamaño sigue del lado server (uploadProductMedia) y client
      // (handleFiles en ai-ingress-panel).
      bodySizeLimit: "20mb",
    },
  },
  images: {
    // sharp ya está instalado: Next optimiza y reescala automáticamente.
    // Además de la compresión al subir, cada tamaño se sirve al vuelo.
    // Hostname derivado de NEXT_PUBLIC_SUPABASE_URL para que al aprovisionar
    // un cliente nuevo no haya que editar este archivo.
    remotePatterns: (() => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const host = url ? new URL(url).hostname : "localhost"
      return [
        {
          protocol: "https",
          hostname: host,
          pathname: "/storage/v1/object/public/**",
        },
      ]
    })(),
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24, // 24 h en el CDN
  },
}

export default nextConfig
