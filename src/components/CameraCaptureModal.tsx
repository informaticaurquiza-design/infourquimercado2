import { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Smartphone, X } from 'lucide-react';
import { readFileAsDataUrl } from '../lib/imageTools';

interface CameraCaptureModalProps {
  open: boolean;
  onClose: () => void;
  onCapture: (rawDataUrl: string) => void;
}

export function CameraCaptureModal({ open, onClose, onCapture }: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }

    let cancelled = false;
    setCameraReady(false);
    setCameraError('');

    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'Tu navegador no permite abrir la cámara en vivo desde esta vista. Usá el botón "Cámara del celular" para tomar la foto.',
        );
        return;
      }

      stopStream();

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: facingMode },
              width: { ideal: 1280 },
              height: { ideal: 960 },
            },
            audio: false,
          });
        } catch {
          // Fallback to any available camera if facingMode constraint fails on desktop
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setCameraReady(true);
        }
      } catch {
        if (cancelled) return;
        setCameraError(
          'No pudimos acceder a la cámara en vivo (verificá el permiso del navegador). También podés usar la cámara nativa de tu celular.',
        );
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, facingMode]);

  function handleSnapPhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const rawDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    stopStream();
    onCapture(rawDataUrl);
  }

  async function handleNativeFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      stopStream();
      onCapture(dataUrl);
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'No pudimos leer la foto tomada.');
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
      <div
        className="fixed inset-0 bg-zinc-950/75 backdrop-blur-[2px]"
        onClick={() => {
          stopStream();
          onClose();
        }}
      />

      <div className="relative z-10 w-full max-w-lg bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-blue-700" />
            <h3 className="font-display text-sm sm:text-base font-bold text-zinc-950">
              Capturar foto con cámara
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            aria-label="Cerrar cámara"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Viewfinder */}
        <div className="p-4 sm:p-5 space-y-4">
          <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-zinc-950 flex items-center justify-center">
            {cameraError ? (
              <div className="p-6 text-center space-y-3 max-w-sm">
                <Smartphone className="w-8 h-8 text-zinc-400 mx-auto stroke-[1.5]" />
                <p className="text-xs text-zinc-200 leading-relaxed">{cameraError}</p>
                <button
                  type="button"
                  onClick={() => nativeCameraInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  Abrir cámara del celular
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
                />
                {!cameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 text-xs text-zinc-200">
                    Iniciando cámara...
                  </div>
                )}
              </>
            )}
          </div>

          <input
            ref={nativeCameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => void handleNativeFileChange(e)}
            className="hidden"
          />

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={() =>
                setFacingMode((mode) => (mode === 'environment' ? 'user' : 'environment'))
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {facingMode === 'environment' ? 'Cámara frontal' : 'Cámara trasera'}
            </button>

            <button
              type="button"
              onClick={() => nativeCameraInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
            >
              <Smartphone className="w-3.5 h-3.5" />
              Cámara del celular
            </button>

            <button
              type="button"
              disabled={!cameraReady}
              onClick={handleSnapPhoto}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-45 rounded-lg transition-colors cursor-pointer ml-auto"
            >
              <Camera className="w-3.5 h-3.5" />
              Tomar foto
            </button>
          </div>
          <p className="text-[11px] text-zinc-500">
            Después de tomar la foto se abrirá automáticamente la herramienta para recortarla y
            encuadrarla.
          </p>
        </div>
      </div>
    </div>
  );
}
