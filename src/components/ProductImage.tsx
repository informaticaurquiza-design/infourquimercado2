import { useState } from 'react';
import { Package } from 'lucide-react';

interface ProductImageProps {
  src: string;
  alt: string;
  className?: string;
  fit?: 'contain' | 'cover';
}

export function ProductImage({
  src,
  alt,
  className = '',
  fit = 'contain',
}: ProductImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const isFailed = !src || failedSrc === src;
  const hasExplicitFit = /\bobject-(contain|cover|fill|none|scale-down)\b/.test(className);
  const fitClass = hasExplicitFit
    ? ''
    : fit === 'cover'
      ? 'object-cover object-center'
      : 'object-contain object-center';
  const baseClasses = `block max-w-full max-h-full ${fitClass} ${className}`.trim();

  if (isFailed) {
    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center bg-zinc-100 text-zinc-400 p-2 text-center overflow-hidden ${className}`}
        role="img"
        aria-label={alt}
      >
        <Package className="w-6 h-6 shrink-0 stroke-[1.5]" />
        <span className="mt-1 text-[11px] font-medium text-zinc-500 line-clamp-2 max-w-[160px]">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={baseClasses}
    />
  );
}
