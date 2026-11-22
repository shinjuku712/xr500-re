import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, Camera, VideoOff, Trash2, CheckCircle2, AlertTriangle, Radio } from 'lucide-react';
import type { PoopHazard } from '../types';

interface PoopGuardPanelProps {
  hazards: PoopHazard[];
  poopRadiusPx: number;
  onChangeRadius: (px: number) => void;
  preFlightGate: boolean;
  onTogglePreFlight: (v: boolean) => void;
  onDeleteHazard: (id: string) => Promise<void>;
  onSelectPoopTool: () => void;
  onEmergencyHalt: (reason: string) => Promise<void>;
}

export const PoopGuardPanel: React.FC<PoopGuardPanelProps> = ({
  hazards,
  poopRadiusPx,
  onChangeRadius,
  preFlightGate,
  onTogglePreFlight,
  onDeleteHazard,
  onSelectPoopTool,
  onEmergencyHalt,
}) => {
  const [camActive, setCamActive] = useState(false);
  const [visionArmed, setVisionArmed] = useState(false);
  const [sensitivity, setSensitivity] = useState(28); // pixel delta threshold
  const [anomalyPct, setAnomalyPct] = useState(0);
  const [alertTriggered, setAlertTriggered] = useState(false);
  const [hasBaseline, setHasBaseline] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const baselineRef = useRef<Uint8ClampedArray | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamActive(false);
    setVisionArmed(false);
  };

  const startCamera = async () => {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 180, facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCamActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setCamError(err instanceof Error ? err.message : 'Camera permission denied');
    }
  };

  useEffect(() => () => stopCamera(), []);

  const grabFrame = (): Uint8ClampedArray | null => {
    const vid = videoRef.current;
    if (!vid || vid.readyState < 2) return null;
    let c = workCanvasRef.current;
    if (!c) {
      c = document.createElement('canvas');
      c.width = 160;
      c.height = 90;
      workCanvasRef.current = c;
    }
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(vid, 0, 0, 160, 90);
    return ctx.getImageData(0, 0, 160, 90).data;
  };

  const captureBaseline = () => {
    const frame = grabFrame();
    if (frame) {
      baselineRef.current = new Uint8ClampedArray(frame);
      setHasBaseline(true);
      setAlertTriggered(false);
    }
  };

  // Real-time floor dark-anomaly detection loop (1 Hz)
  useEffect(() => {
    if (!camActive || !visionArmed || !hasBaseline) return;
    const timer = setInterval(() => {
      const cur = grabFrame();
      const base = baselineRef.current;
      if (!cur || !base) return;

      let darkDiffPixels = 0;
      const total = 160 * 90;
      for (let i = 0; i < cur.length; i += 4) {
        const lCur = 0.299 * cur[i] + 0.587 * cur[i + 1] + 0.114 * cur[i + 2];
        const lBase = 0.299 * base[i] + 0.587 * base[i + 1] + 0.114 * base[i + 2];
        // Specifically detect NEW dark blobs on the floor (darker than clean floor baseline)
        if (lBase - lCur > sensitivity && lCur < 120) {
          darkDiffPixels++;
        }
      }
      const pct = Number(((darkDiffPixels / total) * 100).toFixed(2));
      setAnomalyPct(pct);

      // Localized dark blob between 0.35% and 18% of floor view => likely pet hazard / object
      if (pct >= 0.35 && pct <= 18.0 && !alertTriggered) {
        setAlertTriggered(true);
        onEmergencyHalt(`Floor anomaly detected (${pct}% dark blob) — paused & docking!`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [camActive, visionArmed, hasBaseline, sensitivity, alertTriggered, onEmergencyHalt]);

  return (
    <div className="space-y-4">
      {/* Honest Hardware Note */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-[11px] leading-relaxed text-amber-200/90">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-300">
          <ShieldAlert className="h-3.5 w-3.5" />
          Pet Hazard Shield (XR500T3)
        </div>
        Your XR500 uses 2D LiDAR (no front RGB camera), so this guards your floors 3 ways: instant{' '}
        <span className="font-medium text-white">DP 15 No-Go Poop Pins</span>, a{' '}
        <span className="font-medium text-white">Pre-Flight Check</span>, and optional{' '}
        <span className="font-medium text-white">Room Camera Vision Auto-Halt</span>.
      </div>

      {/* Pre-Flight Floor Check Switch */}
      <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
        <div>
          <div className="text-xs font-medium text-zinc-100">Pre-Flight Poop Check</div>
          <div className="text-[11px] text-zinc-400">Confirm floor is clear before any clean starts</div>
        </div>
        <button
          onClick={() => onTogglePreFlight(!preFlightGate)}
          className={`relative h-5 w-9 rounded-full transition ${
            preFlightGate ? 'bg-amber-500' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              preFlightGate ? 'left-4.5' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {/* Active Poop Pins */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            Active Poop No-Go Pins ({hazards.length})
          </span>
          <button
            onClick={onSelectPoopTool}
            className="rounded-lg border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/25"
          >
            + Drop Poop Pin
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <span className="text-[11px] text-zinc-400">Buffer Radius</span>
          <input
            type="range"
            min={6}
            max={20}
            value={poopRadiusPx}
            onChange={(e) => onChangeRadius(Number(e.target.value))}
            className="w-28 accent-amber-400"
          />
          <span className="w-11 text-right font-mono text-[11px] text-zinc-200">
            {((poopRadiusPx * 5) / 100).toFixed(2)}m
          </span>
        </div>

        {hazards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.08] py-3 text-center text-[11px] text-zinc-500">
            No active pet hazards marked on your house map.
          </div>
        ) : (
          <div className="space-y-1.5">
            {hazards.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-medium text-amber-200">💩 {h.label}</span>
                  <span className="ml-2 font-mono text-[10px] text-zinc-400">
                    {h.created_at} · {((h.radius_px * 10) / 100).toFixed(1)}m box
                  </span>
                </div>
                <button
                  onClick={() => onDeleteHazard(h.id)}
                  title="Cleaned up — remove No-Go bubble"
                  className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                >
                  <Trash2 className="h-3 w-3" /> Clear
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live Room Camera Floor-Anomaly Detector */}
      <div className="space-y-2.5 border-t border-white/[0.07] pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            <Radio className={`h-3.5 w-3.5 ${visionArmed ? 'animate-pulse text-emerald-400' : 'text-zinc-500'}`} />
            Camera Floor Watch
          </div>
          {!camActive ? (
            <button
              onClick={startCamera}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-white/[0.1]"
            >
              <Camera className="h-3.5 w-3.5" /> Enable Cam
            </button>
          ) : (
            <button
              onClick={stopCamera}
              className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20"
            >
              <VideoOff className="h-3 w-3" /> Stop
            </button>
          )}
        </div>

        {camError && <p className="text-[11px] text-rose-400">{camError}</p>}

        {camActive && (
          <div className="space-y-2">
            <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-black">
              <video ref={videoRef} muted playsInline className="h-32 w-full object-cover" />
              {alertTriggered && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-rose-950/80 text-center">
                  <AlertTriangle className="mb-1 h-6 w-6 text-rose-400" />
                  <div className="text-xs font-semibold text-rose-200">HAZARD DETECTED</div>
                  <div className="text-[10px] text-rose-300">Robot Paused & Returning to Dock</div>
                </div>
              )}
              <div className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                Blob: {anomalyPct}%
              </div>
            </div>

            <div className="flex gap-1.5">
              <button
                onClick={captureBaseline}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/[0.1] bg-white/[0.05] py-1.5 text-[11px] font-medium text-zinc-200 hover:bg-white/[0.1]"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                {hasBaseline ? 'Reset Clean Floor' : 'Capture Clean Floor'}
              </button>
              <button
                disabled={!hasBaseline}
                onClick={() => {
                  setAlertTriggered(false);
                  setVisionArmed(!visionArmed);
                }}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-40 ${
                  visionArmed
                    ? 'bg-emerald-500 text-zinc-950'
                    : 'border border-white/[0.1] bg-white/[0.05] text-zinc-200 hover:bg-white/[0.1]'
                }`}
              >
                {visionArmed ? 'Armed' : 'Arm'}
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>Sensitivity</span>
              <input
                type="range"
                min={14}
                max={55}
                value={sensitivity}
                onChange={(e) => setSensitivity(Number(e.target.value))}
                className="w-32 accent-emerald-400"
              />
              <span className="font-mono text-zinc-300">{sensitivity}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
