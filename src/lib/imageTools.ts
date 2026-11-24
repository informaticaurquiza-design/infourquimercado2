export const MAX_PRODUCT_IMAGES = 4;
export const MAX_PRODUCT_IMAGE_CHARS = 155000;

export function isValidImageSource(src: string): boolean {
  const clean = src.trim();
  if (!clean || clean.length > 160000) return false;
  return (
    clean.startsWith('/') ||
    clean.startsWith('https://') ||
    clean.startsWith('http://') ||
    clean.startsWith('data:image/jpeg;base64,') ||
    clean.startsWith('data:image/webp;base64,') ||
    clean.startsWith('data:image/png;base64,')
  );
}

export function getProductGallery(product: { imageUrl?: string; images?: string[] }): string[] {
  const ordered: string[] = [];
  if (Array.isArray(product.images)) {
    for (const img of product.images) {
      if (typeof img === 'string' && img.trim() && !ordered.includes(img.trim())) {
        ordered.push(img.trim());
      }
    }
  }
  if (product.imageUrl && product.imageUrl.trim()) {
    const primary = product.imageUrl.trim();
    if (!ordered.includes(primary)) {
      ordered.unshift(primary);
    }
  }
  return ordered.slice(0, MAX_PRODUCT_IMAGES);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('No pudimos leer el archivo seleccionado.'));
      }
    };
    reader.onerror = () => reject(new Error('Error al leer la imagen del dispositivo.'));
    reader.readAsDataURL(file);
  });
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (src.startsWith('http://') || src.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error(
          'No pudimos cargar la imagen para recortar. Si es una URL externa, descargala y subila desde tu dispositivo.',
        ),
      );
    img.src = src;
  });
}

/**
 * Normalizes and rotates an image onto an intermediate canvas (capped at 1600px)
 * so interactive mobile/desktop cropping stays fast and mathematically exact.
 */
export async function buildWorkingImage(
  src: string,
  rotationDeg: number,
  maxEdge = 1600,
): Promise<{ img: HTMLImageElement; width: number; height: number; dataUrl: string }> {
  const raw = await loadHtmlImage(src);
  const normalizedRot = ((rotationDeg % 360) + 360) % 360;
  const swapDims = normalizedRot === 90 || normalizedRot === 270;

  const srcW = raw.naturalWidth || raw.width;
  const srcH = raw.naturalHeight || raw.height;
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH, 1));
  const scaledW = Math.max(1, Math.round(srcW * scale));
  const scaledH = Math.max(1, Math.round(srcH * scale));

  const outW = swapDims ? scaledH : scaledW;
  const outH = swapDims ? scaledW : scaledH;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Tu navegador no soporta edición de imágenes en canvas.');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((normalizedRot * Math.PI) / 180);
  ctx.drawImage(raw, -scaledW / 2, -scaledH / 2, scaledW, scaledH);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const workingImg = await loadHtmlImage(dataUrl);
  return { img: workingImg, width: outW, height: outH, dataUrl };
}

/**
 * Crops the exact source region and adaptively compresses JPEG output
 * so every product photo stays crisp and guaranteed under Firestore's size limits.
 */
export function exportCroppedImage(params: {
  sourceImg: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  targetWidth: number;
  targetHeight: number;
  maxChars?: number;
  framePlacement?: {
    relX: number;
    relY: number;
    relW: number;
    relH: number;
  };
}): { dataUrl: string; width: number; height: number; approxKb: number } {
  const maxChars = params.maxChars ?? 135000;
  let width = Math.max(120, Math.round(params.targetWidth));
  let height = Math.max(90, Math.round(params.targetHeight));

  const qualities = [0.84, 0.76, 0.68, 0.6, 0.52];
  const srcFullW = params.sourceImg.naturalWidth || params.sourceImg.width;
  const srcFullH = params.sourceImg.naturalHeight || params.sourceImg.height;

  const drawOntoCanvas = (ctx: CanvasRenderingContext2D, dstW: number, dstH: number) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, dstW, dstH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (params.framePlacement) {
      const { relX, relY, relW, relH } = params.framePlacement;
      ctx.drawImage(
        params.sourceImg,
        0,
        0,
        srcFullW,
        srcFullH,
        relX * dstW,
        relY * dstH,
        relW * dstW,
        relH * dstH,
      );
    } else {
      ctx.drawImage(
        params.sourceImg,
        params.sx,
        params.sy,
        params.sw,
        params.sh,
        0,
        0,
        dstW,
        dstH,
      );
    }
  };

  for (let pass = 0; pass < 3; pass += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo inicializar el editor de recorte.');
    }

    drawOntoCanvas(ctx, width, height);

    for (const q of qualities) {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      if (dataUrl.length <= maxChars) {
        return {
          dataUrl,
          width,
          height,
          approxKb: Math.max(1, Math.round((dataUrl.length * 0.75) / 1024)),
        };
      }
    }

    width = Math.max(240, Math.round(width * 0.8));
    height = Math.max(180, Math.round(height * 0.8));
  }

  // Final guaranteed-fit pass
  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = 480;
  fallbackCanvas.height = Math.max(270, Math.round((480 * params.targetHeight) / params.targetWidth));
  const fCtx = fallbackCanvas.getContext('2d');
  if (!fCtx) {
    throw new Error('No se pudo exportar la imagen recortada.');
  }
  drawOntoCanvas(fCtx, fallbackCanvas.width, fallbackCanvas.height);
  const dataUrl = fallbackCanvas.toDataURL('image/jpeg', 0.5);
  return {
    dataUrl,
    width: fallbackCanvas.width,
    height: fallbackCanvas.height,
    approxKb: Math.max(1, Math.round((dataUrl.length * 0.75) / 1024)),
  };
}

/**
 * Generates a compact thumbnail for order line-item receipts when a product's
 * cover photo is a base64 data URL, keeping Order documents lightweight.
 */
export async function createCompactThumbnail(
  imageUrl: string,
  fallbackUrl: string,
): Promise<string> {
  const trimmed = (imageUrl || '').trim();
  if (!trimmed) return fallbackUrl;
  if (!trimmed.startsWith('data:image/')) {
    return trimmed.slice(0, 300);
  }
  try {
    const img = await loadHtmlImage(trimmed);
    const canvas = document.createElement('canvas');
    const outW = 160;
    const outH = 120;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallbackUrl;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outW, outH);

    // Proportionally fit entire product inside 4:3 thumbnail without cropping
    const natW = Math.max(1, img.naturalWidth || img.width);
    const natH = Math.max(1, img.naturalHeight || img.height);
    const scale = Math.min(outW / natW, outH / natH);
    const drawW = natW * scale;
    const drawH = natH * scale;
    const dx = (outW - drawW) / 2;
    const dy = (outH - drawH) / 2;
    ctx.drawImage(img, 0, 0, natW, natH, dx, dy, drawW, drawH);
    const thumb = canvas.toDataURL('image/jpeg', 0.72);
    return thumb.length <= 16000 ? thumb : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

/**
 * Compresses an uploaded transfer receipt photo or screenshot so text stays
 * legible for payment extraction while fitting cleanly in Firestore and local DB.
 */
export async function compressReceiptImage(
  file: File,
  maxChars = 145000,
): Promise<{ dataUrl: string; approxKb: number }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Seleccioná una imagen del comprobante (JPG, PNG o WebP).');
  }
  const rawUrl = await readFileAsDataUrl(file);
  const img = await loadHtmlImage(rawUrl);

  const srcW = img.naturalWidth || img.width || 800;
  const srcH = img.naturalHeight || img.height || 1000;
  let maxEdge = 1150;
  const qualities = [0.85, 0.78, 0.7, 0.62, 0.54, 0.46];

  for (let pass = 0; pass < 4; pass += 1) {
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH, 1));
    const outW = Math.max(200, Math.round(srcW * scale));
    const outH = Math.max(200, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Tu navegador no soporta el procesamiento de comprobantes.');
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, outW, outH);

    for (const q of qualities) {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      if (dataUrl.length <= maxChars) {
        return {
          dataUrl,
          approxKb: Math.max(1, Math.round((dataUrl.length * 0.75) / 1024)),
        };
      }
    }
    maxEdge = Math.round(maxEdge * 0.78);
  }

  throw new Error('La imagen del comprobante es demasiado grande. Probá con una captura más liviana.');
}

