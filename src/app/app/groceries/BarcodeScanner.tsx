"use client";

import { useEffect, useRef, useState } from "react";

// Minimal typing for the experimental BarcodeDetector API.
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = new (opts?: {
  formats?: string[];
}) => BarcodeDetectorLike;

export default function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported =
    typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    if (!supported) {
      setError(
        "Camera scanning isn't supported on this browser. Use a handheld scanner or type the barcode."
      );
      return;
    }

    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    const Detector = (
      window as unknown as { BarcodeDetector: BarcodeDetectorCtor }
    ).BarcodeDetector;
    const detector = new Detector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
    });

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        scanLoop();
      } catch {
        setError("Couldn't access the camera. Check permissions.");
      }
    }

    async function scanLoop() {
      if (stopped || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes.length > 0) {
          onDetected(codes[0].rawValue);
          return; // stop after first hit
        }
      } catch {
        // ignore transient detect errors
      }
      raf = requestAnimationFrame(scanLoop);
    }

    start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-4 w-[360px] max-w-[92vw]">
        <h3 className="font-semibold text-gray-800 mb-3 text-center">
          Scan a barcode
        </h3>
        {error ? (
          <p className="text-sm text-gray-600 text-center py-6">{error}</p>
        ) : (
          <div className="rounded-xl overflow-hidden bg-black aspect-video">
            <video
              ref={videoRef}
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <p className="text-xs text-gray-400 text-center mt-2">
          Point the camera at the product barcode.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full py-2 rounded-lg text-gray-600 hover:bg-gray-100 text-sm font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}
