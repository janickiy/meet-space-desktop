import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const HeaderSlots = createContext<{
  title: HTMLElement | null;
  actions: HTMLElement | null;
}>({ title: null, actions: null });

export function WorkspaceHeaderTitle({ children }: { children: ReactNode }) {
  const { title } = useContext(HeaderSlots);
  return title ? createPortal(children, title) : null;
}

export function WorkspaceHeaderActions({ children }: { children: ReactNode }) {
  const { actions } = useContext(HeaderSlots);
  return actions ? createPortal(children, actions) : null;
}
