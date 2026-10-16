import type { PlatformAdapter } from "./types";
import { externalServiceURL } from "./urls";

export const webPlatform: PlatformAdapter = {
  kind: "web",
  async getRuntimeInfo() {
    return null;
  },
  async openExternal(url) {
    window.open(externalServiceURL(url), "_blank", "noopener,noreferrer");
  },
  onRoute() {
    // BrowserRouter already owns navigation in the web application.
    return () => {};
  },
};
