declare const __DESKTOP_BUILD__: boolean;

/** Selected at build time; an injected browser property cannot enable desktop mode. */
export const isDesktopBuild =
  typeof __DESKTOP_BUILD__ !== "undefined" && __DESKTOP_BUILD__;
