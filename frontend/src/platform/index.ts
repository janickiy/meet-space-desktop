import { isDesktopBuild } from "./build";
import { desktopPlatform } from "./desktop";
import { webPlatform } from "./web";

export const platform = isDesktopBuild ? desktopPlatform : webPlatform;
export { isDesktopBuild } from "./build";
export type { PlatformAdapter, DesktopRuntimeInfo } from "./types";
