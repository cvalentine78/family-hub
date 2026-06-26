"use client";

import { useEffect, useRef, useState } from "react";

const CROP_SIZE = 288; // on-screen crop box (px)
const OUTPUT_SIZE = 512; // exported image (px)

export default function CropModal({
  src,
  onCancel,
  onConfirm,
}: {
  src: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const drag = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  // Load natural dimensions once.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      imgRef.current = img;
    };
    img.src = src;
  }, [src]);

  if (!natural) {
    return (
      <Overlay>
        <p className="text-white">Loading image…</p>
      </Overlay>
    );
  }

  // "Cover" base scale so the smaller dimension fills the box at zoom 1.
  const baseScale = CROP_SIZE / Math.min(natural.w, natural.h);
  const scale = baseScale * zoom;
  const dispW = natural.w * scale;
  const dispH = natural.h * scale;

  // How far the image can move while still covering the box.
  const maxX = Math.max(0, (dispW - CROP_SIZE) / 2);
  const maxY = Math.max(0, (dispH - CROP_SIZE) / 2);

  function clamp(v: number, max: number) {
    return Math.max(-max, Math.min(max, v));
  }

  const left = CROP_SIZE / 2 - dispW / 2 + offset.x;
  const top = CROP_SIZE / 2 - dispH / 2 + offset.y;

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    setOffset({
      x: clamp(drag.current.baseX + dx, maxX),
      y: clamp(drag.current.baseY + dy, maxY),
    });
  }

  function onPointerUp() {
    drag.current = null;
  }

  // Re-clamp the offset whenever zoom changes.
  function handleZoom(z: number) {
    setZoom(z);
    const newScale = baseScale * z;
    const nMaxX = Math.max(0, (natural!.w * newScale - CROP_SIZE) / 2);
    const nMaxY = Math.max(0, (natural!.h * newScale - CROP_SIZE) / 2);
    setOffset((o) => ({ x: clamp(o.x, nMaxX), y: clamp(o.y, nMaxY) }));
  }

  function handleSave() {
    const img = imgRef.current;
    if (!img) return;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Map the crop box back into natural image coordinates.
    const sx = (0 - left) / scale;
    const sy = (0 - top) / scale;
    const sSize = CROP_SIZE / scale;

    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    canvas.toBlob(
      (blob) => {
        if (blob) onConfirm(blob);
      },
      "image/jpeg",
      0.9
    );
  }

  return (
    <Overlay>
      <div className="bg-white rounded-2xl p-5 w-[336px] max-w-[90vw]">
        <h3 className="font-semibold text-gray-800 mb-3 text-center">
          Position your photo
        </h3>

        <div
          className="relative mx-auto rounded-full overflow-hidden bg-gray-100 cursor-grab active:cursor-grabbing touch-none select-none"
          style={{ width: CROP_SIZE, height: CROP_SIZE }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Crop preview"
            draggable={false}
            style={{
              position: "absolute",
              left,
              top,
              width: dispW,
              height: dispH,
              maxWidth: "none",
            }}
          />
          {/* subtle ring */}
          <div className="absolute inset-0 rounded-full ring-1 ring-black/10 pointer-events-none" />
        </div>

        <div className="flex items-center gap-2 mt-4">
          <span className="text-gray-400 text-xs">−</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => handleZoom(parseFloat(e.target.value))}
            className="flex-1 accent-sky-600"
          />
          <span className="text-gray-400 text-xs">+</span>
        </div>
        <p className="text-xs text-gray-400 text-center mt-1">
          Drag to reposition · slide to zoom
        </p>

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-gray-600 hover:bg-gray-100 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold"
          >
            Use photo
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      {children}
    </div>
  );
}
