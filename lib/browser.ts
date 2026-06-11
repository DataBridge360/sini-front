// Helpers que tocan APIs del navegador (storage, estilos computados, archivos).

export function readView<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  return (window.localStorage.getItem(key) as T | null) ?? fallback;
}

export function writeView(key: string, value: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(key, value);
}


export function readTransitionMs(variable: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(variable);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

export async function avatarFileToDataUrl(file: File) {
  const maxSize = 256;
  const quality = 0.82;
  const image = await loadImage(file);
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return await fileToDataUrl(file);
  }
  context.drawImage(image, 0, 0, width, height);
  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  return canvas.toDataURL(mimeType, quality);
}

export function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to load image"));
    };
    image.src = url;
  });
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}
