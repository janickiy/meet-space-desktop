/** Product versions only: Darwin kernel releases must never be passed here. */
export function isSupportedMacOS(productVersion: string, arch: string): boolean {
  if (!["x64", "arm64"].includes(arch)) return false;
  const match = /^(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?$/.exec(productVersion);
  return !!match && match[0] === productVersion && Number(match[1]) >= 15;
}
