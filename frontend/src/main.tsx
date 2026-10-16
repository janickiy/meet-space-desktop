import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/cyrillic-500.css";
import "@fontsource/inter/cyrillic-600.css";
import "@fontsource/inter/cyrillic-700.css";
import "./styles.css";
import "./accessibility.css";
import "./tokens.css";
import "./workspace.css";
import "./appearance.css";
import "./desktop-design.css";
import { PRODUCT_DESCRIPTION, PRODUCT_TAGLINE } from "./brand";
import { ApiError } from "./api";
import { AuthProvider } from "./auth";
import { AppearanceProvider } from "./appearance";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installClientTelemetry } from "./clientTelemetry";
import { installRecordingAudioUnlock } from "./recordingAnnouncement";
import { isDesktopBuild } from "./platform/build";
import { DesktopSessionGate } from "./components/desktop/DesktopSessionGate";
import { saveSession } from "./utils";

const stopTelemetry = isDesktopBuild ? () => {} : installClientTelemetry();
const stopRecordingAudioUnlock = isDesktopBuild
  ? () => {}
  : installRecordingAudioUnlock();
if (isDesktopBuild) saveSession(null);
document.title = PRODUCT_DESCRIPTION;
document
  .querySelector('meta[name="description"]')
  ?.setAttribute("content", `${PRODUCT_DESCRIPTION} ${PRODUCT_TAGLINE}`);
if (import.meta.hot) import.meta.hot.dispose(stopTelemetry);
if (import.meta.hot) import.meta.hot.dispose(stopRecordingAudioUnlock);

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10000,
        /**
         * retry решает, допустим ли повтор запроса с учётом ошибки и числа отказов.
         *
         * @args
         *   - count — число уже выполненных попыток.
         *   - error — пойманная ошибка API или сети.
         *
         * @returns вычисленное значение: !( error instanceof ApiError && error.status >= 400 && error.status < 500 ) && count < 1.
         */
        retry: (count, error) =>
          !(
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500
          ) && count < 1,
      },
      mutations: { retry: false },
    },
  });
function Application() {
  const [queryClient] = useState(createQueryClient);
  useEffect(
    () => () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    },
    [queryClient],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppearanceProvider>
          <App />
        </AppearanceProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        {isDesktopBuild ? (
          <DesktopSessionGate>
            {(key) => <Application key={key} />}
          </DesktopSessionGate>
        ) : (
          <Application />
        )}
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
