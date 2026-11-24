import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Share2,
  X,
} from 'lucide-react';
import { getProductGallery, loadHtmlImage } from '../lib/imageTools';
import { formatCurrency } from '../lib/validation';
import type { Product } from '../types/ecommerce';
import { ProductImage } from './ProductImage';

interface FacebookShareModalProps {
  product: Product | null;
  shareBaseUrl: string;
  isPrivateOriginWithoutPublicUrl: boolean;
  onClose: () => void;
  onNotifyToast: (msg: string) => void;
}

function FacebookMark({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07c0 6.02 4.39 11.01 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.08 24 18.09 24 12.07Z" />
    </svg>
  );
}

async function imageSourceToJpegFile(src: string, fileName: string): Promise<File> {
  if (src.startsWith('data:image/')) {
    const res = await fetch(src);
    const blob = await res.blob();
    const mime = blob.type || 'image/jpeg';
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `${fileName}.${ext}`, { type: mime });
  }

  try {
    const res = await fetch(src, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.type.startsWith('image/')) {
        const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
        return new File([blob], `${fileName}.${ext}`, { type: blob.type });
      }
    }
  } catch {
    // Fallback to canvas conversion below
  }

  const img = await loadHtmlImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width || 1200;
  canvas.height = img.naturalHeight || img.height || 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No pudimos preparar la imagen para compartir.');
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('No pudimos exportar la foto en JPG.'))),
      'image/jpeg',
      0.92,
    );
  });
  return new File([blob], `${fileName}.jpg`, { type: 'image/jpeg' });
}

export function FacebookShareModal({
  product,
  shareBaseUrl,
  isPrivateOriginWithoutPublicUrl,
  onClose,
  onNotifyToast,
}: FacebookShareModalProps) {
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [copiedText, setCopiedText] = useState(false);
  const [downloadingPhoto, setDownloadingPhoto] = useState(false);
  const [sharingNative, setSharingNative] = useState(false);

  const gallery = useMemo(() => (product ? getProductGallery(product) : []), [product]);

  useEffect(() => {
    setSelectedPhotoIndex(0);
    setCopiedText(false);
  }, [product?.id]);

  const canNativeShareFiles = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  }, []);

  if (!product) return null;

  const safeIndex = Math.min(selectedPhotoIndex, Math.max(0, gallery.length - 1));
  const selectedPhotoSrc = gallery[safeIndex] || product.imageUrl;

  const cleanBase = shareBaseUrl.replace(/\/+$/, '');
  const shareCardUrl = cleanBase
    ? `${cleanBase}/share/producto/${encodeURIComponent(product.id)}?foto=${safeIndex}`
    : '';
  const directStoreUrl = cleanBase
    ? `${cleanBase}/?producto=${encodeURIComponent(product.id)}`
    : '';

  const snippet = product.description.trim();
  const shortDesc = snippet.length > 130 ? `${snippet.slice(0, 127).trimEnd()}...` : snippet;
  const priceLine = `Precio: ${formatCurrency(product.price)}${
    product.freeShipping ? ' · Envío gratis' : ''
  }`;
  const stockLine =
    product.stock > 0
      ? `Stock disponible (${product.stock} u.)`
      : 'Consultar disponibilidad';

  const shareText = [
    product.name,
    priceLine,
    `${product.categoryLabel} · SKU ${product.sku} · ${stockLine}`,
    ...(shortDesc ? [shortDesc] : []),
    ...(shareCardUrl ? [`Ver en Infourqui Mercado: ${shareCardUrl}`] : []),
  ].join('\n');

  const facebookQuote = [
    product.name,
    priceLine,
    shortDesc || `${product.categoryLabel} · SKU ${product.sku}`,
    'Disponible en Infourqui Mercado',
  ]
    .filter(Boolean)
    .join(' — ');

  const facebookSharerHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
    shareCardUrl || directStoreUrl,
  )}&quote=${encodeURIComponent(facebookQuote)}`;

  const safeFileBase = (product.sku || product.id || 'articulo')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedText(true);
      onNotifyToast('Texto y enlace copiados para pegar en Facebook.');
      window.setTimeout(() => setCopiedText(false), 2200);
    } catch {
      onNotifyToast('No pudimos copiar al portapapeles en este navegador.');
    }
  }

  async function handleDownloadPhoto() {
    setDownloadingPhoto(true);
    try {
      const file = await imageSourceToJpegFile(
        selectedPhotoSrc,
        `${safeFileBase}-foto-${safeIndex + 1}`,
      );
      const objectUrl = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      onNotifyToast('Foto del artículo descargada. Podés adjuntarla directo en Facebook.');
    } catch {
      onNotifyToast('No pudimos descargar la foto. Probá con otra imagen o desde la URL pública.');
    } finally {
      setDownloadingPhoto(false);
    }
  }

  async function handleNativeShareWithPhoto() {
    if (!canNativeShareFiles || !product) return;
    const shareTitle = `${product.name} — ${formatCurrency(product.price)}`;
    setSharingNative(true);
    try {
      const file = await imageSourceToJpegFile(
        selectedPhotoSrc,
        `${safeFileBase}-foto-${safeIndex + 1}`,
      );
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          files: [file],
        });
        onNotifyToast('Foto y publicación listas para enviar.');
      } else {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareCardUrl || directStoreUrl,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      onNotifyToast('No pudimos abrir el menú de compartir con foto. Usá "Descargar foto".');
    } finally {
      setSharingNative(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/55 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fb-share-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl border border-zinc-200 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-blue-600 text-white inline-flex items-center justify-center shrink-0">
              <FacebookMark className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3
                id="fb-share-modal-title"
                className="font-display text-sm font-bold text-zinc-950 truncate"
              >
                Compartir artículo en Facebook
              </h3>
              <p className="text-[11px] text-zinc-500 truncate">
                Elegí la foto del producto para incluirla en tu publicación
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Facebook Post Preview Card */}
          <div className="border border-zinc-200 rounded-xl overflow-hidden bg-zinc-50">
            <div className="relative aspect-[16/10] bg-zinc-50 overflow-hidden flex items-center justify-center">
              <ProductImage
                src={selectedPhotoSrc}
                alt={product.name}
                className="w-full h-full object-contain object-center"
              />
              <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-zinc-950/75 text-white">
                <ImageIcon className="w-3 h-3" />
                Foto {safeIndex + 1} de {Math.max(1, gallery.length)}
              </span>
              {product.freeShipping && (
                <span className="absolute top-2.5 right-2.5 px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 text-white">
                  Envío gratis
                </span>
              )}
            </div>
            <div className="p-3.5 bg-white border-t border-zinc-200">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500 truncate">
                {cleanBase ? cleanBase.replace(/^https?:\/\//i, '') : 'Infourqui Mercado'}
              </p>
              <p className="font-display text-sm font-bold text-zinc-950 mt-0.5 line-clamp-1">
                {product.name} — {formatCurrency(product.price)}
              </p>
              <p className="text-xs text-zinc-600 mt-1 line-clamp-2">
                {shortDesc || `${product.categoryLabel} · SKU ${product.sku} · ${stockLine}`}
              </p>
            </div>
          </div>

          {/* Photo Selector if multiple photos */}
          {gallery.length > 1 && (
            <div>
              <p className="text-[11px] font-semibold text-zinc-600 mb-2">
                Seleccioná qué foto enviar ({gallery.length} disponibles)
              </p>
              <div className="grid grid-cols-4 gap-2">
                {gallery.map((imgSrc, idx) => {
                  const active = idx === safeIndex;
                  return (
                    <button
                      key={`${product.id}-thumb-${idx}`}
                      type="button"
                      onClick={() => setSelectedPhotoIndex(idx)}
                      className={`relative aspect-[4/3] rounded-lg overflow-hidden border-2 transition-all cursor-pointer bg-white flex items-center justify-center ${
                        active
                          ? 'border-blue-600 ring-2 ring-blue-600/20'
                          : 'border-zinc-200 hover:border-zinc-400 opacity-80 hover:opacity-100'
                      }`}
                    >
                      <ProductImage
                        src={imgSrc}
                        alt={`${product.name} — foto ${idx + 1}`}
                        className="w-full h-full object-contain object-center"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Localhost / private network hint */}
          {isPrivateOriginWithoutPublicUrl && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Estás en una dirección local. Para que Facebook cargue la foto automáticamente en la
                vista previa del enlace, activá la dirección pública de <strong>Cloudflare</strong>{' '}
                en <strong>Red Local</strong>, o usá <strong>Descargar foto</strong> para subirla
                directo a tu publicación.
              </p>
            </div>
          )}

          {/* Primary Actions */}
          <div className="space-y-2.5 pt-1">
            <a
              href={facebookSharerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <FacebookMark className="w-4 h-4" />
              Publicar en Facebook con esta foto
              <ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </a>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={downloadingPhoto}
                onClick={() => void handleDownloadPhoto()}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-zinc-800 bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                {downloadingPhoto ? 'Preparando foto...' : 'Descargar foto JPG'}
              </button>

              <button
                type="button"
                onClick={() => void handleCopyText()}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-zinc-800 bg-zinc-100 hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                {copiedText ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    Texto copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copiar texto y enlace
                  </>
                )}
              </button>
            </div>

            {canNativeShareFiles && (
              <button
                type="button"
                disabled={sharingNative}
                onClick={() => void handleNativeShareWithPhoto()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                {sharingNative
                  ? 'Abriendo opciones...'
                  : 'Enviar foto directa desde el celular / app'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
