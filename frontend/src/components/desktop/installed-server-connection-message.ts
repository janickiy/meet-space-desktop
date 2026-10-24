/** Only native error codes select text; transport messages may contain secrets. */
export function installedServerConnectionMessage(cause: unknown): string {
  const value =
    cause && typeof cause === "object" && "code" in cause ? cause.code : "";
  const code = typeof value === "string" ? value.toLowerCase() : "";
  switch (code) {
    case "incompatible_server":
      return "Сервер установлен, но его версия несовместима с этим приложением. Обновите MeetSpace Desktop или обратитесь к администратору сервера.";
    case "tls_error":
      return "Не удалось проверить сертификат HTTPS-сервера. Проверьте сертификат и повторите подключение.";
    case "dns_error":
      return "Не удалось найти сервер по доменному имени. Проверьте домен и его DNS-записи.";
    case "network_timeout":
      return "Сервер не ответил вовремя. Повторите подключение.";
    case "network_unavailable":
      return "Не удалось связаться с сервером. Проверьте подключение к сети и доступность сервера.";
    case "secure_storage_unavailable":
    case "storage_unavailable":
      return "Защищённое хранилище системы недоступно. Перезапустите приложение и повторите подключение.";
    case "secure_storage_corrupt":
      return "Не удалось восстановить сохранённую сессию. Перезапустите приложение и повторите подключение.";
    case "invalid_server":
      return "Проверьте адрес сервера: нужен HTTPS-адрес без пути, пароля и параметров.";
    case "invalid_response":
      return "Сервер вернул некорректный ответ. Повторите подключение или обратитесь к администратору сервера.";
    case "redirect_not_allowed":
      return "Сервер перенаправил запрос. Проверьте его адрес.";
    default:
      return "Сервер установлен, но подключиться к нему не удалось. Повторите попытку. Если ошибка сохраняется, обратитесь к администратору сервера.";
  }
}
