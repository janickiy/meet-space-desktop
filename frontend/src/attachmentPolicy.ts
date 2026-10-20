import formats from "./attachment-formats.json";

export const attachmentLimit = 10 * 1024 * 1024;
export const attachmentAccept = formats
  .flatMap((format) => format.extensions.map((extension) => `.${extension}`))
  .join(",");

const byExtension = new Map(
  formats.flatMap((format) =>
    format.extensions.map((extension) => [extension, format] as const),
  ),
);

function attachmentFormat(filename: string) {
  const extension = /\.([^.]+)$/.exec(filename)?.[1].toLowerCase();
  return extension ? byExtension.get(extension) : undefined;
}

// OS MIME databases differ, and may report archives as empty or octet-stream.
// Use the same canonical type for init and PUT; the server validates the bytes.
export function attachmentMimeType(file: Pick<File, "name">): string {
  return attachmentFormat(file.name)?.mimeType || "application/octet-stream";
}

export function validateAttachment(
  file: Pick<File, "name" | "size">,
): string | null {
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > attachmentLimit
  )
    return "Размер файла должен быть от 1 байта до 10 МБ.";
  if (!attachmentFormat(file.name))
    return "Можно прикрепить изображения JPG, PNG, WebP, документы и архивы.";
  return null;
}
