import { useState } from 'react';
import { Package } from 'lucide-react';

interface ProductImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function ProductImage({ src, alt, className = '' }: ProductImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const isFailed = !src || failedSrc === src;

  if (isFailed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-zinc-100 text-zinc-400 p-6 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <Package className="w-8 h-8 mb-2 stroke-[1.5]" />
        <span className="text-xs font-medium text-zinc-500 line-clamp-2 max-w-[180px]">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
}
