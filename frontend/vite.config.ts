import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { buildMetadataPlugin, readBuildMetadata } from "./build-metadata.ts";

const buildMetadata = readBuildMetadata(process.env);
const telemetryFlag = process.env.VITE_CLIENT_TELEMETRY_ENABLED || "false";
if (!["true", "false"].includes(telemetryFlag))
  throw new Error("VITE_CLIENT_TELEMETRY_ENABLED must be true or false");

/** The foundation build has no server transport until the next integration stage. */
function desktopFoundationPlugin(): Plugin {
  return {
    name: "desktop-foundation-boundary",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?")[0] || "";
        if (path !== "/api" && !path.startsWith("/api/")) return next();
        response.statusCode = 403;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(
          JSON.stringify({
            status: "failed",
            message: "Use the validated desktop transport.",
          }),
        );
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const desktop = mode === "desktop";
  const desktopDev = desktop && command === "serve";
  const devNonce = process.env.MEETSPACE_DEV_CSP_NONCE;
  if (desktopDev && !/^[a-f0-9]{48}$/.test(devNonce || ""))
    throw new Error(
      "Desktop development requires MEETSPACE_DEV_CSP_NONCE from the desktop launcher",
    );
  return {
    html: desktopDev ? { cspNonce: devNonce } : undefined,
    plugins: [
      react(),
      buildMetadataPlugin(buildMetadata),
      ...(desktop ? [desktopFoundationPlugin()] : []),
    ],
    define: {
      __APP_BUILD__: JSON.stringify(buildMetadata),
      __CLIENT_TELEMETRY_ENABLED__: !desktop && telemetryFlag === "true",
      __DESKTOP_BUILD__: desktop,
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: desktop
        ? undefined
        : {
            "/api": {
              target: process.env.API_PROXY_TARGET || "http://127.0.0.1:8085",
              changeOrigin: false,
              ws: true,
            },
          },
    },
    build: {
      target: ["chrome120", "firefox120", "safari17"],
      sourcemap: false,
      outDir: desktop ? "dist-desktop" : "dist",
    },
  };
});
