import { useRef, useState } from 'react';
import { Camera, Crop, Link2, Plus, Star, Trash2, Upload } from 'lucide-react';
import {
  MAX_PRODUCT_IMAGES,
  isValidImageSource,
  readFileAsDataUrl,
} from '../lib/imageTools';
import { CameraCaptureModal } from './CameraCaptureModal';
import { ImageCropModal } from './ImageCropModal';
import { ProductImage } from './ProductImage';

interface ProductImagesEditorProps {
  images: string[];
  onChange: (nextImages: string[]) => void;
  defaultCategoryImage: string;
  productName: string;
}

export function ProductImagesEditor({
  images,
  onChange,
  defaultCategoryImage,
  productName,
}: ProductImagesEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [urlInputOpen, setUrlInputOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [localError, setLocalError] = useState('');

  // Pending image waiting in the crop studio (index === null means adding a new slot)
  const [cropSession, setCropSession] = useState<{
    src: string;
    replaceIndex: number | null;
  } | null>(null);

  const canAddMore = images.length < MAX_PRODUCT_IMAGES;

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canAddMore) return;

    setLocalError('');
    if (!file.type.startsWith('image/')) {
      setLocalError('Seleccioná un archivo de imagen válido (JPG, PNG o WebP).');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCropSession({ src: dataUrl, replaceIndex: null });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'No pudimos cargar la foto seleccionada.');
    }
  }

  function handleCameraCaptured(rawDataUrl: string) {
    setCameraOpen(false);
    setLocalError('');
    setCropSession({ src: rawDataUrl, replaceIndex: null });
  }

  function handleApplyCropped(croppedDataUrl: string) {
    if (!cropSession) return;
    if (cropSession.replaceIndex !== null) {
      const next = images.map((img, idx) =>
        idx === cropSession.replaceIndex ? croppedDataUrl : img,
      );
      onChange(next);
    } else if (images.length < MAX_PRODUCT_IMAGES) {
      onChange([...images, croppedDataUrl]);
    }
    setCropSession(null);
  }

  function handleAddByUrl() {
    setLocalError('');
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    if (!canAddMore) {
      setLocalError(`Podés cargar hasta ${MAX_PRODUCT_IMAGES} fotos por producto.`);
      return;
    }
    if (!isValidImageSource(trimmed)) {
      setLocalError('Ingresá una URL válida que comience con https:// o /.');
      return;
    }
    onChange([...images, trimmed]);
    setUrlDraft('');
    setUrlInputOpen(false);
  }

  function handleSetAsCover(index: number) {
    if (index <= 0 || index >= images.length) return;
    const chosen = images[index];
    const rest = images.filter((_, idx) => idx !== index);
    onChange([chosen, ...rest]);
  }

  function handleRemoveImage(index: number) {
    onChange(images.filter((_, idx) => idx !== index));
  }

  const emptySlotsCount = Math.max(0, MAX_PRODUCT_IMAGES - images.length);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <label className="block text-xs font-semibold text-zinc-800">
            Galería de fotos del producto
          </label>
          <p className="text-[11px] text-zinc-500">
            Cargá hasta {MAX_PRODUCT_IMAGES} imágenes con cámara o archivo y recortá cada una antes
            de guardar.
          </p>
        </div>
        <span className="font-mono text-xs font-medium text-zinc-700 tabular-nums">
          {images.length} / {MAX_PRODUCT_IMAGES} fotos
        </span>
      </div>

      {localError && (
        <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {localError}
        </div>
      )}

      {/* Action Buttons: Camera, Upload, Optional URL */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canAddMore}
          onClick={() => {
            setLocalError('');
            setCameraOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-45 rounded-lg transition-colors cursor-pointer"
        >
          <Camera className="w-3.5 h-3.5" />
          Usar cámara
        </button>

        <button
          type="button"
          disabled={!canAddMore}
          onClick={() => {
            setLocalError('');
            fileInputRef.current?.click();
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-900 bg-white border border-zinc-300 hover:border-zinc-950 disabled:opacity-45 rounded-lg transition-colors cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" />
          Subir foto
        </button>

        <button
          type="button"
          disabled={!canAddMore}
          onClick={() => {
            setLocalError('');
            setUrlInputOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-600 bg-white border border-zinc-200 hover:border-zinc-400 disabled:opacity-45 rounded-lg transition-colors cursor-pointer"
        >
          <Link2 className="w-3.5 h-3.5" />
          Pegar URL
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => void handleFileSelected(e)}
          className="hidden"
        />
      </div>

      {/* Inline URL Entry */}
      {urlInputOpen && canAddMore && (
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://ejemplo.com/foto-producto.jpg"
            className="flex-1 px-3 py-2 text-xs bg-white border border-zinc-300 rounded-lg focus:outline-none focus:border-blue-700"
          />
          <button
            type="button"
            onClick={handleAddByUrl}
            className="px-3 py-2 text-xs font-medium text-white bg-zinc-950 hover:bg-blue-700 rounded-lg cursor-pointer whitespace-nowrap"
          >
            Agregar
          </button>
        </div>
      )}

      {/* 4-Slot Photo Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {images.map((src, idx) => (
          <div
            key={`${idx}-${src.slice(0, 32)}`}
            className="border border-zinc-200 rounded-lg overflow-hidden bg-white flex flex-col"
          >
            <div className="aspect-[4/3] bg-zinc-50 overflow-hidden flex items-center justify-center">
              <ProductImage
                src={src}
                alt={`${productName || 'Producto'} — foto ${idx + 1}`}
                className="w-full h-full object-contain object-center"
              />
            </div>
            <div className="px-2 py-1.5 border-t border-zinc-100 flex items-center justify-between gap-1 bg-zinc-50/70">
              {idx === 0 ? (
                <span className="text-[11px] font-semibold text-blue-700 truncate">Portada</span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSetAsCover(idx)}
                  title="Usar como portada"
                  className="inline-flex items-center gap-1 text-[11px] text-zinc-600 hover:text-blue-700 cursor-pointer truncate"
                >
                  <Star className="w-3 h-3 shrink-0" />
                  <span>Portada</span>
                </button>
              )}

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setLocalError('');
                    setCropSession({ src, replaceIndex: idx });
                  }}
                  title="Recortar imagen"
                  aria-label={`Recortar foto ${idx + 1}`}
                  className="w-6 h-6 inline-flex items-center justify-center rounded text-zinc-500 hover:text-blue-700 hover:bg-white cursor-pointer"
                >
                  <Crop className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveImage(idx)}
                  title="Quitar imagen"
                  aria-label={`Quitar foto ${idx + 1}`}
                  className="w-6 h-6 inline-flex items-center justify-center rounded text-zinc-400 hover:text-red-600 hover:bg-white cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {Array.from({ length: emptySlotsCount }).map((_, idx) => {
          const slotNumber = images.length + idx + 1;
          return (
            <button
              key={`empty-slot-${slotNumber}`}
              type="button"
              onClick={() => {
                setLocalError('');
                fileInputRef.current?.click();
              }}
              className="aspect-[4/3] border border-dashed border-zinc-300 hover:border-blue-700 hover:bg-blue-50/30 rounded-lg flex flex-col items-center justify-center gap-1 text-zinc-400 hover:text-blue-700 transition-colors cursor-pointer p-2 text-center"
            >
              <Plus className="w-4 h-4" />
              <span className="text-[11px] font-medium">Foto {slotNumber}</span>
            </button>
          );
        })}
      </div>

      {images.length === 0 && (
        <div className="flex items-center gap-3 p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg">
          <div className="w-12 h-9 rounded overflow-hidden bg-white border border-zinc-200 shrink-0 flex items-center justify-center">
            <ProductImage
              src={defaultCategoryImage}
              alt="Foto predeterminada del rubro"
              className="w-full h-full object-contain object-center"
            />
          </div>
          <p className="text-[11px] text-zinc-500 leading-snug">
            Si no cargás ninguna foto, se utilizará automáticamente la imagen predeterminada del
            rubro seleccionado.
          </p>
        </div>
      )}

      {/* Camera & Crop Modals */}
      <CameraCaptureModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCaptured}
      />

      <ImageCropModal
        open={cropSession !== null}
        sourceSrc={cropSession?.src ?? ''}
        onCancel={() => setCropSession(null)}
        onApply={handleApplyCropped}
      />
    </div>
  );
}
