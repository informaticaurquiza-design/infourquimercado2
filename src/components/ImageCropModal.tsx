import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Crop,
  Move,
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { buildWorkingImage, exportCroppedImage } from '../lib/imageTools';

interface ImageCropModalProps {
  open: boolean;
  sourceSrc: string;
  onCancel: () => void;
  onApply: (croppedDataUrl: string) => void;
}

type AspectPresetId = '4:3' | '1:1' | '3:2';

const ASPECT_PRESETS: {
  id: AspectPresetId;
  label: string;
  ratio: number;
  aspectClass: string;
  targetWidth: number;
  targetHeight: number;
}[] = [
  {
    id: '4:3',
    label: '4:3 Catálogo',
    ratio: 4 / 3,
    aspectClass: 'aspect-[4/3]',
    targetWidth: 800,
    targetHeight: 600,
  },
  {
    id: '1:1',
    label: '1:1 Cuadrado',
    ratio: 1,
    aspectClass: 'aspect-square',
    targetWidth: 720,
    targetHeight: 720,
  },
  {
    id: '3:2',
    label: '3:2 Horizontal',
    ratio: 3 / 2,
    aspectClass: 'aspect-[3/2]',
    targetWidth: 840,
    targetHeight: 560,
  },
];

interface WorkingImageState {
  img: HTMLImageElement;
  width: number;
  height: number;
  dataUrl: string;
}

export function ImageCropModal({ open, sourceSrc, onCancel, onApply }: ImageCropModalProps) {
  const [aspectId, setAspectId] = useState<AspectPresetId>('4:3');
  const [rotationDeg, setRotationDeg] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [working, setWorking] = useState<WorkingImageState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [frameSize, setFrameSize] = useState({ width: 320, height: 240 });

  const frameRef = useRef<HTMLDivElement | null>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);

  const preset = useMemo(
    () => ASPECT_PRESETS.find((p) => p.id === aspectId) ?? ASPECT_PRESETS[0],
    [aspectId],
  );

  // Reset controls when a new source image opens
  useEffect(() => {
    if (!open) return;
    setAspectId('4:3');
    setRotationDeg(0);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError('');
  }, [open, sourceSrc]);

  // Build normalized + rotated working image
  useEffect(() => {
    if (!open || !sourceSrc) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    buildWorkingImage(sourceSrc, rotationDeg)
      .then((result) => {
        if (cancelled) return;
        setWorking(result);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      })
      .catch((err) => {
        if (cancelled) return;
        setWorking(null);
        setError(err instanceof Error ? err.message : 'No pudimos preparar la imagen.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, sourceSrc, rotationDeg]);

  // Observe crop frame DOM dimensions for exact WYSIWYG coordinate mapping
  useEffect(() => {
    if (!open || !frameRef.current) return;
    const node = frameRef.current;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setFrameSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, aspectId]);

  const baseScale = useMemo(() => {
    if (!working) return 1;
    return Math.max(frameSize.width / working.width, frameSize.height / working.height);
  }, [working, frameSize]);

  const renderWidth = working ? working.width * baseScale * zoom : 0;
  const renderHeight = working ? working.height * baseScale * zoom : 0;

  function clampOffset(nextX: number, nextY: number, nextZoom = zoom) {
    if (!working) return { x: 0, y: 0 };
    const rW = working.width * baseScale * nextZoom;
    const rH = working.height * baseScale * nextZoom;
    const maxX = Math.max(0, (rW - frameSize.width) / 2);
    const maxY = Math.max(0, (rH - frameSize.height) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, nextX)),
      y: Math.max(-maxY, Math.min(maxY, nextY)),
    };
  }

  // Keep pan offset clamped whenever zoom or frame size changes
  useEffect(() => {
    setOffset((curr) => clampOffset(curr.x, curr.y, zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, frameSize.width, frameSize.height, working]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!working) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStart.current = { dist: Math.max(1, dist), zoom };
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!working || !activePointers.current.has(e.pointerId)) return;
    const prev = activePointers.current.get(e.pointerId)!;
    const next = { x: e.clientX, y: e.clientY };
    activePointers.current.set(e.pointerId, next);

    if (activePointers.current.size === 2 && pinchStart.current) {
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const scaleFactor = dist / pinchStart.current.dist;
      const nextZoom = Math.max(1, Math.min(3, pinchStart.current.zoom * scaleFactor));
      setZoom(Number(nextZoom.toFixed(2)));
      return;
    }

    if (activePointers.current.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      setOffset((curr) => clampOffset(curr.x + dx, curr.y + dy));
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      pinchStart.current = null;
    }
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!working) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.12 : -0.12;
    setZoom((z) => Math.max(1, Math.min(3, Number((z + delta).toFixed(2)))));
  }

  function handleConfirmCrop() {
    if (!working) return;
    try {
      const totalScale = baseScale * zoom;
      const imgLeft = (frameSize.width - renderWidth) / 2 + offset.x;
      const imgTop = (frameSize.height - renderHeight) / 2 + offset.y;

      const rawSx = (0 - imgLeft) / totalScale;
      const rawSy = (0 - imgTop) / totalScale;
      const rawSw = frameSize.width / totalScale;
      const rawSh = frameSize.height / totalScale;

      const sx = Math.max(0, Math.min(working.width - 1, rawSx));
      const sy = Math.max(0, Math.min(working.height - 1, rawSy));
      const sw = Math.max(1, Math.min(working.width - sx, rawSw));
      const sh = Math.max(1, Math.min(working.height - sy, rawSh));

      const exported = exportCroppedImage({
        sourceImg: working.img,
        sx,
        sy,
        sw,
        sh,
        targetWidth: preset.targetWidth,
        targetHeight: preset.targetHeight,
      });

      onApply(exported.dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos recortar la imagen.');
    }
  }

  if (!open) return null;

  const imgLeft = (frameSize.width - renderWidth) / 2 + offset.x;
  const imgTop = (frameSize.height - renderHeight) / 2 + offset.y;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
      <div
        className="fixed inset-0 bg-zinc-950/75 backdrop-blur-[2px]"
        onClick={onCancel}
      />

      <div className="relative z-10 w-full max-w-2xl bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <Crop className="w-4 h-4 text-blue-700" />
            <h3 className="font-display text-sm sm:text-base font-bold text-zinc-950">
              Recortar y encuadrar foto
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar editor de recorte"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Crop Stage */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          {/* Aspect Ratio Selector & Rotation */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 p-1 bg-zinc-100 rounded-lg">
              {ASPECT_PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setAspectId(item.id);
                    setOffset({ x: 0, y: 0 });
                  }}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    aspectId === item.id
                      ? 'bg-white text-zinc-950 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRotationDeg((deg) => (deg + 90) % 360)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Girar 90°
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setOffset({ x: 0, y: 0 });
                }}
                aria-label="Restablecer encuadre"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Centrar
              </button>
            </div>
          </div>

          {/* Interactive Viewport */}
          <div className="bg-zinc-950 rounded-xl p-4 sm:p-6 flex items-center justify-center">
            <div
              ref={frameRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onWheel={handleWheel}
              className={`relative w-full ${
                aspectId === '1:1' ? 'max-w-[320px]' : 'max-w-[440px]'
              } ${preset.aspectClass} overflow-hidden rounded-lg bg-zinc-900 border-2 border-white/90 shadow-lg select-none touch-none cursor-grab active:cursor-grabbing`}
            >
              {loading ? (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-300">
                  Preparando imagen...
                </div>
              ) : working ? (
                <img
                  src={working.dataUrl}
                  alt="Vista previa para recortar"
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: `${imgLeft}px`,
                    top: `${imgTop}px`,
                    width: `${renderWidth}px`,
                    height: `${renderHeight}px`,
                    maxWidth: 'none',
                  }}
                />
              ) : null}

              {/* Subtle Rule-of-Thirds Crop Grid */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
              </div>
            </div>
          </div>

          {/* Drag Hint + Zoom Controls */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1.5">
                <Move className="w-3.5 h-3.5 text-zinc-400" />
                Arrastrá la imagen para encuadrar · Pellizcá o usá el zoom
              </span>
              <span className="font-mono text-zinc-800 font-medium tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(1, Number((z - 0.15).toFixed(2))))}
                aria-label="Alejar"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 hover:border-zinc-950 cursor-pointer shrink-0"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label="Nivel de zoom del recorte"
                className="flex-1 accent-blue-700 cursor-pointer"
              />
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3, Number((z + 0.15).toFixed(2))))}
                aria-label="Acercar"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 hover:border-zinc-950 cursor-pointer shrink-0"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-zinc-200 bg-zinc-50">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!working || loading}
            onClick={handleConfirmCrop}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            Aplicar recorte
          </button>
        </div>
      </div>
    </div>
  );
}
