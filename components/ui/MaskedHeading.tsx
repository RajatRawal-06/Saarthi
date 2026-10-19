'use client';

import React, { useRef } from 'react';

export interface MaskedHeadingProps {
  text: string;
  mediaType?: 'video' | 'image' | 'gradient';
  src?: string;
  poster?: string;
  fillScale?: number;
  parallax?: number;
  reveal?: 'scale' | 'fade' | 'slide';
  trigger?: 'view' | 'scroll' | 'hover';
  spotlight?: boolean;
  spotlightRadius?: number;
  outline?: boolean;
  outlineWidth?: number;
  duration?: number;
  stagger?: number;
  drift?: number;
  hoverZoom?: number;
  align?: 'left' | 'center' | 'right';
  brightness?: number;
  saturation?: number;
  grayscale?: boolean;
  weight?: number | string;
  tracking?: number;
  lineHeight?: number;
  textScale?: number;
  className?: string;
}

export const MaskedHeading: React.FC<MaskedHeadingProps> = ({
  text,
  mediaType = 'gradient',
  src,
  poster,
  align = 'center',
  brightness = 1,
  saturation = 1,
  grayscale = false,
  outline = false,
  outlineWidth = 1,
  weight = 800,
  tracking = -0.03,
  lineHeight = 1.06,
  className = ''
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const filterStyle = [
    brightness !== 1 ? `brightness(${brightness})` : '',
    saturation !== 1 ? `saturate(${saturation})` : '',
    grayscale ? 'grayscale(100%)' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={containerRef}
      className={`masked-heading-container relative overflow-hidden flex items-center justify-${align === 'center' ? 'center' : align === 'right' ? 'end' : 'start'} ${className}`}
      style={{
        textAlign: align,
        letterSpacing: `${tracking}em`,
        lineHeight
      }}
    >
      {mediaType === 'video' && src ? (
        <div className="relative inline-block w-full">
          <video
            autoPlay
            loop
            muted
            playsInline
            poster={poster}
            src={src}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none opacity-0"
          />
          <h1
            className="font-extrabold uppercase bg-clip-text text-transparent bg-gradient-to-r from-orange-600 via-amber-500 to-rose-600 drop-shadow-sm select-none"
            style={{
              fontWeight: weight,
              filter: filterStyle || undefined,
              WebkitTextStroke: outline ? `${outlineWidth}px rgba(0,0,0,0.15)` : undefined
            }}
          >
            {text}
          </h1>
        </div>
      ) : (
        <h1
          className="font-extrabold uppercase bg-clip-text text-transparent bg-gradient-to-r from-orange-600 via-amber-500 to-rose-600 drop-shadow-sm select-none"
          style={{
            fontWeight: weight,
            filter: filterStyle || undefined,
            WebkitTextStroke: outline ? `${outlineWidth}px rgba(0,0,0,0.15)` : undefined
          }}
        >
          {text}
        </h1>
      )}
    </div>
  );
};

export default MaskedHeading;
