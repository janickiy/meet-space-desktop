import { app, dialog } from "electron";
import { startApp } from "./main";

// Electron may import the package entry without assigning require.main.
// Keep the application entry explicit and library imports passive for fixtures.
void startApp().catch(() => {
  // Details can contain private URLs or paths; never forward raw exceptions to logs/UI.
  dialog.showErrorBox(
    "MeetSpace",
    "Не удалось запустить приложение. Проверьте установку и повторите запуск.",
  );
  app.quit();
});
