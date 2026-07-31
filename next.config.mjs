/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    // sharp ya está instalado: Next optimiza y reescala automáticamente.
    // Además de la compresión al subir, cada tamaño se sirve al vuelo.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "nxszaxwsrtlofqimbfig.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24, // 24 h en el CDN
  },
}

export default nextConfig
