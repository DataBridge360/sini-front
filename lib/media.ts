// Compresión de adjuntos en el navegador, antes de subirlos al backend.
//
// Imágenes (JPG/PNG/WEBP): se redimensionan a un máximo de 1920px y se
// recodifican a WEBP con calidad 0.82. Si el resultado no es más liviano que
// el original (o algo falla), se sube el original tal cual.
//
// GIF se sube sin tocar (recodificarlo perdería la animación). Los videos
// también van sin tocar: el navegador no puede transcodificar video de forma
// razonable; comprimirlos requiere procesamiento server-side (ver nota en
// PAGINADO.md / plan de mejoras).

const COMPRESSIBLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_DIMENSION_PX = 1920;
const WEBP_QUALITY = 0.82;
// Por debajo de este peso no vale la pena recodificar: el ahorro es marginal.
const SKIP_UNDER_BYTES = 200 * 1024;

export async function compressAttachment(file: File): Promise<File> {
  if (!COMPRESSIBLE_IMAGE_TYPES.has(file.type) || file.size <= SKIP_UNDER_BYTES) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY)
    );
    if (!blob || blob.size >= file.size) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "imagen";
    return new File([blob], `${baseName}.webp`, { type: "image/webp" });
  } catch {
    // Formato corrupto o no soportado por createImageBitmap: va el original.
    return file;
  }
}
