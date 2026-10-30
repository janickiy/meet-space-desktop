import type { MenuItemConstructorOptions } from "electron";

interface ApplicationMenuOptions {
  platform: NodeJS.Platform;
  show(): void;
  hide(): void;
  close(): void;
  quit(): void;
  trayAvailable: boolean;
}

/** Dock and menu bar actions stay inside the owned application window lifecycle. */
export function createMacOSDockMenu(options: {
  show(): void;
  hide(): void;
  quit(): void;
  visible: boolean;
}): MenuItemConstructorOptions[] {
  return [
    { id: "meetspace-native-open", label: "Открыть MeetSpace", click: options.show },
    { id: "meetspace-native-hide", label: "Скрыть MeetSpace", enabled: options.visible, click: options.hide },
    { type: "separator" },
    { id: "meetspace-native-quit", label: "Выход из MeetSpace", click: options.quit },
  ];
}

/** Only trusted main-process callbacks enter the native menu. No remote links or developer tools. */
export function createApplicationMenu(options: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const quit: MenuItemConstructorOptions = { id: "meetspace-quit", label: "Выход из MeetSpace",
    accelerator: "CommandOrControl+Q", click: options.quit };
  const open: MenuItemConstructorOptions = { label: "Открыть MeetSpace", click: options.show };
  const menu: MenuItemConstructorOptions[] = options.platform === "darwin" ? [
    { label: "MeetSpace", submenu: [
      { role: "about", label: "О MeetSpace" },
      { type: "separator" },
      { role: "services", label: "Службы", submenu: [] },
      { type: "separator" },
      { role: "hide", label: "Скрыть MeetSpace" },
      { role: "hideOthers", label: "Скрыть остальные" },
      { role: "unhide", label: "Показать все" },
      { type: "separator" },
      quit,
    ] },
    { label: "Файл", submenu: [open,
      // A callback routes Cmd+W through the same close policy as the red window button.
      { id: "meetspace-close-window", label: "Закрыть окно", accelerator: "Command+W", click: options.close },
    ] },
  ] : [
    { label: "MeetSpace", submenu: [open,
      { id: "meetspace-hide-to-tray", label: "Скрыть в трей", enabled: options.trayAvailable, click: options.hide },
      { type: "separator" },
      quit,
    ] },
  ];
  menu.push(
    { label: "Правка", submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ] },
    { label: "Вид", submenu: [
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
      { type: "separator" }, { role: "togglefullscreen" },
    ] },
    { role: "windowMenu" },
  );
  return menu;
}
