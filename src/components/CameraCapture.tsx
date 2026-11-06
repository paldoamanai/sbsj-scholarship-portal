"use client";

// "Take photo": a document photo straight from the camera, as an option next to Upload.
//   * Live camera in a dialog (the back camera on phones), with a frame to line the page up in.
//   * Scan mode (on by default): turns the shot into a clean black-and-white page, easier to read.
//   * Where the browser can't open the camera (no camera, permission denied, an in-app browser), it
//     falls back to the phone's own camera app through a file input with `capture`.
// The result is a JPEG File, passed to onCapture like a picked file.

import { useCallback, useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, RotateCcw } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Grayscale, then stretch contrast so paper goes white and ink goes dark. */
function scanPixels(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // Brightness range from a sample, ignoring the darkest and brightest 2%.
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 16) hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  const total = hist.reduce((t, n) => t + n, 0);
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255 && acc + hist[lo] < total * 0.02; lo++) acc += hist[lo];
  acc = 0;
  for (; hi > 0 && acc + hist[hi] < total * 0.02; hi--) acc += hist[hi];
  const range = Math.max(32, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    let v = ((y - lo) / range) * 255;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    // A gentle curve: lighter background, darker text.
    v = v > 140 ? Math.min(255, v * 1.12) : v * 0.85;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

export default function CameraCapture({ onCapture, disabled, label = "Take photo", className, scanDefault = true, title = "Take a photo" }: {
  onCapture: (file: File) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  /** Classes for the trigger button. */
  className?: string;
  /** Start in scan mode (black and white). Off for photos of places, e.g. a house. */
  scanDefault?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [canFlip, setCanFlip] = useState(false);
  const [scan, setScan] = useState(scanDefault);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(false);
  openRef.current = open;
  // The video element can mount after the stream is ready (the dialog opens in a portal): attach then.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => {});
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (mode: "environment" | "user") => {
    stop();
    setError(null);
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false,
      });
      // Closed while the camera was starting: let it go.
      if (!openRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      attachVideo(videoRef.current);
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      setCanFlip(cams.length > 1);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setError(name === "NotAllowedError" ? "Camera access was blocked. Allow the camera for this site in your browser settings, or use your phone's camera app instead."
        : name === "NotFoundError" ? "No camera was found on this device."
        : "The camera couldn't be opened here.");
    } finally {
      setStarting(false);
    }
  }, [stop, attachVideo]);

  useEffect(() => {
    if (open && !shot) void start(facing);
    if (!open) stop();
  }, [open, shot, facing, start, stop]);
  useEffect(() => () => stop(), [stop]);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const openCamera = () => {
    // No live camera API (old browser, or an insecure page): the phone's camera app instead.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) { fallbackRef.current?.click(); return; }
    setShot(null); setScan(scanDefault); setOpen(true);
  };

  const capture = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: scan });
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    if (scan) scanPixels(ctx, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    if (!blob) return;
    stop();
    setShot({ blob, url: URL.createObjectURL(blob) });
  };

  const use = async () => {
    if (!shot) return;
    setSaving(true);
    const stamp = new Date().toISOString().slice(0, 19).replace(/\D/g, "");
    try {
      await onCapture(new File([shot.blob], `photo-${stamp}.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
      setOpen(false); setShot(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button type="button" disabled={disabled} onClick={openCamera}
        className={cn("inline-flex items-center justify-center gap-1.5 rounded-xl border border-primary/30 px-3 py-2.5 sm:py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50 cursor-pointer", className)}>
        <Camera className="h-3.5 w-3.5" />{label}
      </button>
      {/* Fallback: the device's own camera app. */}
      <input ref={fallbackRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onCapture(f); }} />

      <AppDialog open={open} onOpenChange={(o) => { if (!saving) { setOpen(o); if (!o) setShot(null); } }} size="lg" title={title}
        description={shot ? "Check that every corner of the page is in the photo and the text is readable." : "Lay the page flat in good light and fit the whole page inside the frame."}
        footer={shot ? <>
          <Button variant="outline" disabled={saving} onClick={() => setShot(null)}><RotateCcw className="mr-1 h-4 w-4" /> Retake</Button>
          <Button disabled={saving} onClick={use}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Use this photo</Button>
        </> : <>
          {error && <Button variant="outline" onClick={() => { setOpen(false); fallbackRef.current?.click(); }}>Use phone camera app</Button>}
          {canFlip && !error && <Button variant="outline" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}>Switch camera</Button>}
          <Button disabled={!!error || starting} onClick={capture}><Camera className="mr-1 h-4 w-4" /> Capture</Button>
        </>}>
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL)
          <img src={shot.url} alt="Your photo" className="mx-auto block max-h-[calc(100dvh-16rem)] w-auto max-w-full rounded-lg border object-contain" />
        ) : error ? (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        ) : (
          <div className="space-y-2">
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video ref={attachVideo} playsInline muted autoPlay
                className={cn("mx-auto block max-h-[calc(100dvh-19rem)] w-full object-contain", scan && "grayscale contrast-125", facing === "user" && "-scale-x-100")} />
              {/* Frame to line the page up in */}
              <div aria-hidden className="pointer-events-none absolute inset-[6%] rounded-md border-2 border-dashed border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
              {starting && <div className="absolute inset-0 flex items-center justify-center text-sm text-white"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening camera…</div>}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={scan} onChange={(e) => setScan(e.target.checked)} />
              Scan mode: black and white, easier to read
            </label>
          </div>
        )}
      </AppDialog>
    </>
  );
}
