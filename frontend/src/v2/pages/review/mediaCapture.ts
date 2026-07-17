/**
 * Capture & export côté client (menu clic droit de la review, miniatures) :
 * frame vidéo → data URL, copie presse-papiers, téléchargement, réduction miniature.
 * Toutes les fonctions lèvent une Error à message lisible (affichée en toast).
 */

/** Frame courante d'une vidéo → data URL JPEG. Lève si le canvas est « tainted » (CORS). */
export function captureVideoFrame(video: HTMLVideoElement, quality = 0.88): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (!canvas.width || !canvas.height) throw new Error('Vidéo pas encore décodée');
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    throw new Error('Capture impossible (source vidéo non autorisée en lecture canvas)');
  }
}

/** Réduit une image (data URL ou URL) au gabarit miniature (JPEG ≤ maxWidth px de large). */
export async function toThumbnailDataUrl(src: string, maxWidth = 640): Promise<string> {
  const img = await loadImage(src);
  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Fichier image local → data URL miniature (réduit, JPEG). */
export async function fileToThumbnailDataUrl(file: File, maxWidth = 640): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    return await toThumbnailDataUrl(url, maxWidth);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Copie une image (data URL ou URL distante) dans le presse-papiers (PNG). */
export async function copyImageToClipboard(src: string): Promise<void> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Encodage PNG impossible');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Télécharge une ressource (data URL ou URL distante, via blob pour forcer le download). */
export async function downloadImage(src: string, filename: string): Promise<void> {
  const blob = src.startsWith('data:')
    ? await (await fetch(src)).blob()
    : await (await fetch(src, { mode: 'cors' })).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Chargement de l’image impossible'));
    img.src = src;
  });
}
