import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  ImageUp,
  Loader2,
  RefreshCw,
  ScanBarcode,
  SwitchCamera,
  X,
} from 'lucide-react';
import {
  decodeBarcodeFromImageFile,
  decodeBarcodeFromVideoFrame,
} from '../lib/barcodeDecoder';

interface SkuBarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onDetected: (sku: string) => void;
}

function sanitizeScannedSku(raw: string): string {
  return raw
    .trim()
    .replace(/[\r\n\t]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._/-]/g, '')
    .toUpperCase()
    .slice(0, 32);
}

function playScanBeep() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 250);
  } catch {
    // ignore audio restrictions
  }
}

export function SkuBarcodeScannerModal({
  open,
  onClose,
  onDetected,
}: SkuBarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasDecodedRef = useRef(false);
  const scanSessionRef = useRef(0);

  const [status, setStatus] = useState<'initializing' | 'scanning' | 'error'>('initializing');
  const [errorMessage, setErrorMessage] = useState('');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [decodingImage, setDecodingImage] = useState(false);

  const stopCameraStream = useCallback(() => {
    scanSessionRef.current += 1;
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    const videoEl = videoRef.current;
    if (videoEl && videoEl.srcObject) {
      const stream = videoEl.srcObject as MediaStream;
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      videoEl.srcObject = null;
    }
  }, []);

  const handleSuccessfulScan = useCallback(
    (rawText: string) => {
      if (hasDecodedRef.current) return;
      const clean = sanitizeScannedSku(rawText);
      if (!clean) return;
      hasDecodedRef.current = true;
      playScanBeep();
      stopCameraStream();
      onDetected(clean);
      onClose();
    },
    [onClose, onDetected, stopCameraStream],
  );

  const startScanner = useCallback(
    async (preferredDeviceId?: string | null) => {
      stopCameraStream();
      const sessionId = scanSessionRef.current;
      hasDecodedRef.current = false;
      setStatus('initializing');
      setErrorMessage('');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('error');
        setErrorMessage(
          'Este navegador no habilitó el acceso en vivo a la cámara (en celulares requiere conexión HTTPS o Cloudflare). Podés usar el botón "Escanear desde foto".',
        );
        return;
      }

      const videoEl = videoRef.current;
      if (!videoEl) return;

      const constraints: MediaStreamConstraints = preferredDeviceId
        ? {
            audio: false,
            video: {
              deviceId: { exact: preferredDeviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          }
        : {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (scanSessionRef.current !== sessionId) {
          stream.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch {
              // ignore
            }
          });
          return;
        }

        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});

        if (!scratchCanvasRef.current) {
          scratchCanvasRef.current = document.createElement('canvas');
        }

        setStatus('scanning');

        let busyDecoding = false;
        const scanLoop = async () => {
          if (scanSessionRef.current !== sessionId || hasDecodedRef.current) return;
          if (!busyDecoding && videoEl.readyState >= 2 && scratchCanvasRef.current) {
            busyDecoding = true;
            try {
              const decoded = await decodeBarcodeFromVideoFrame(videoEl, scratchCanvasRef.current);
              if (decoded && scanSessionRef.current === sessionId) {
                handleSuccessfulScan(decoded);
                return;
              }
            } catch {
              // ignore transient frame error
            } finally {
              busyDecoding = false;
            }
          }
          if (scanSessionRef.current === sessionId && !hasDecodedRef.current) {
            scanTimerRef.current = window.setTimeout(() => {
              void scanLoop();
            }, 170);
          }
        };

        void scanLoop();

        try {
          const allDevices = await navigator.mediaDevices.enumerateDevices();
          if (scanSessionRef.current !== sessionId) return;
          const videoDevices = allDevices.filter((d) => d.kind === 'videoinput');
          setCameras(videoDevices);
        } catch {
          // ignore device enumeration failure
        }
      } catch (err) {
        if (scanSessionRef.current !== sessionId) return;
        stopCameraStream();
        setStatus('error');
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setErrorMessage(
            'Permiso de cámara denegado. Habilitá el permiso de cámara en tu navegador o usá "Escanear desde foto".',
          );
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setErrorMessage(
            'No se encontró ninguna cámara conectada en este dispositivo. Podés usar "Escanear desde foto".',
          );
        } else if (name === 'NotReadableError') {
          setErrorMessage(
            'La cámara está siendo utilizada por otra aplicación. Cerrala e intentá nuevamente.',
          );
        } else {
          setErrorMessage(
            'No pudimos abrir la cámara en vivo. Verificá los permisos o usá "Escanear desde foto".',
          );
        }
      }
    },
    [handleSuccessfulScan, stopCameraStream],
  );

  useEffect(() => {
    if (!open) {
      stopCameraStream();
      setSelectedDeviceId(null);
      return;
    }
    void startScanner(selectedDeviceId);
    return () => {
      stopCameraStream();
    };
  }, [open, selectedDeviceId, startScanner, stopCameraStream]);

  async function handleDecodePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMessage('');
    setDecodingImage(true);
    try {
      const decoded = await decodeBarcodeFromImageFile(file);
      if (!decoded) {
        throw new Error('No se detectó un código legible.');
      }
      handleSuccessfulScan(decoded);
    } catch {
      setErrorMessage(
        'No pudimos leer un código de barras o QR en esa foto. Asegurate de enfocar bien el código con buena luz.',
      );
    } finally {
      setDecodingImage(false);
    }
  }

  function handleSwitchCamera() {
    if (cameras.length < 2) return;
    const currentIndex = cameras.findIndex((c) => c.deviceId === selectedDeviceId);
    const nextCamera = cameras[(currentIndex + 1) % cameras.length];
    if (nextCamera) {
      setSelectedDeviceId(nextCamera.deviceId);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-zinc-950/70 backdrop-blur-[1px]"
        onClick={() => {
          stopCameraStream();
          onClose();
        }}
      />
      <div className="relative z-10 w-full max-w-md bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <ScanBarcode className="w-4 h-4 text-blue-700" />
            <h3 className="font-display text-sm font-bold text-zinc-950">
              Escanear SKU con cámara
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCameraStream();
              onClose();
            }}
            aria-label="Cerrar escáner de SKU"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-zinc-600 leading-relaxed">
            Apuntá la cámara al código de barras (EAN-13, EAN-8, UPC, Code 128/39) o código QR del
            producto para completar automáticamente el campo SKU.
          </p>

          {/* Camera Viewport */}
          <div className="relative aspect-[4/3] w-full bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 flex items-center justify-center">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className={`w-full h-full object-cover ${status === 'error' ? 'opacity-20' : ''}`}
            />

            {status === 'initializing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/70 text-white text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                <span>Iniciando cámara...</span>
              </div>
            )}

            {status === 'scanning' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <div className="relative w-full max-w-[260px] h-32 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(9,9,11,0.42)]">
                  <span className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-0.5 bg-blue-500/90 animate-pulse" />
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center text-zinc-200">
                <Camera className="w-7 h-7 text-zinc-400" />
                <p className="text-xs leading-relaxed max-w-xs">{errorMessage}</p>
              </div>
            )}
          </div>

          {errorMessage && status !== 'error' && (
            <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {errorMessage}
            </div>
          )}

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {cameras.length > 1 && (
                <button
                  type="button"
                  onClick={handleSwitchCamera}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
                >
                  <SwitchCamera className="w-3.5 h-3.5" />
                  Cambiar cámara
                </button>
              )}

              {status === 'error' && (
                <button
                  type="button"
                  onClick={() => void startScanner(selectedDeviceId)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-800 bg-white border border-zinc-300 hover:border-zinc-950 rounded-lg cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reintentar cámara
                </button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => void handleDecodePhotoFile(e)}
                className="hidden"
              />
              <button
                type="button"
                disabled={decodingImage}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-800 bg-zinc-50 hover:bg-zinc-100 border border-zinc-300 rounded-lg disabled:opacity-50 cursor-pointer"
              >
                {decodingImage ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImageUp className="w-3.5 h-3.5" />
                )}
                {decodingImage ? 'Leyendo foto...' : 'Escanear desde foto'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                stopCameraStream();
                onClose();
              }}
              className="px-3.5 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-950 cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
