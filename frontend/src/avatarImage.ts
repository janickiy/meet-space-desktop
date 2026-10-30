export const MAX_AVATAR_SOURCE_BYTES = 5 * 1024 * 1024;
export type AvatarCrop = { zoom: number; x: number; y: number };
export const DEFAULT_AVATAR_CROP: AvatarCrop = { zoom: 1, x: 0, y: 0 };
export const clampAvatarOffset = (value: number) =>
  Math.max(-100, Math.min(100, value));

export function avatarSourceError(
  file: Pick<File, "size" | "type">,
): string | undefined {
  if (!file.size || file.size > MAX_AVATAR_SOURCE_BYTES)
    return "Выберите изображение размером до 5 МБ.";
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    return "Для аватара подходят PNG, JPEG и WebP.";
}

export function avatarCropRect(
  width: number,
  height: number,
  crop: AvatarCrop,
) {
  const zoom = Math.max(1, Math.min(3, crop.zoom));
  const side = Math.min(width, height) / zoom;
  return {
    side,
    left: ((width - side) * (100 - clampAvatarOffset(crop.x))) / 200,
    top: ((height - side) * (100 - clampAvatarOffset(crop.y))) / 200,
    horizontal: width - side > 0.001,
    vertical: height - side > 0.001,
  };
}

/** Decode locally, apply EXIF orientation, and release stale image resources. */
export async function decodeAvatarSource(file: File, signal: AbortSignal) {
  const error = avatarSourceError(file);
  if (error) throw new Error(error);
  signal.throwIfAborted();
  const image = await createImageBitmap(file, {
    imageOrientation: "from-image",
  }).catch(() => {
    signal.throwIfAborted();
    throw new Error("Не удалось открыть изображение. Выберите другой файл.");
  });
  if (
    signal.aborted ||
    !image.width ||
    !image.height ||
    image.width * image.height > 40_000_000
  ) {
    image.close();
    signal.throwIfAborted();
    throw new Error(
      "Изображение слишком большое. Выберите фото до 40 мегапикселей.",
    );
  }
  return image;
}

export function drawAvatar(
  canvas: HTMLCanvasElement,
  image: ImageBitmap,
  crop: AvatarCrop,
) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Не удалось подготовить изображение.");
  const { side, left, top } = avatarCropRect(image.width, image.height, crop);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    left,
    top,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  );
}

/** Only the selected square is uploaded; the circular mask is presentation. */
export async function encodeAvatar(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<File> {
  signal.throwIfAborted();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Не удалось обработать фото.")),
      "image/jpeg",
      0.88,
    ),
  );
  signal.throwIfAborted();
  if (blob.size > 2 * 1024 * 1024)
    throw new Error("Не удалось уменьшить фото до 2 МБ.");
  return new File([blob], "avatar.jpg", { type: "image/jpeg" });
}

export async function prepareAvatar(
  file: File,
  signal: AbortSignal,
): Promise<File> {
  const image = await decodeAvatarSource(file, signal);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    drawAvatar(canvas, image, DEFAULT_AVATAR_CROP);
    return await encodeAvatar(canvas, signal);
  } finally {
    image.close();
  }
}
