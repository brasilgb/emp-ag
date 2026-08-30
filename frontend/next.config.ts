import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera um build "standalone" (server.js + apenas os node_modules
  // efetivamente usados), o que permite uma imagem Docker final bem mais
  // enxuta (ver frontend/Dockerfile).
  output: "standalone",
};

export default nextConfig;
