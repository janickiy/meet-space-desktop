type LinkClick = {
  isTrusted: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
};

/** Keep web navigation native; desktop links use the existing, allowlisted OS browser bridge. */
export function externalLinkClick(
  event: LinkClick,
  desktop: boolean,
  href: string,
  openExternal: (url: string) => Promise<void>,
): Promise<void> | undefined {
  if (!desktop || event.defaultPrevented) return undefined;
  event.preventDefault();
  if (!event.isTrusted) return undefined;
  // Includes synchronous validation errors without leaking addresses or native error text.
  return Promise.resolve().then(() => openExternal(href));
}
