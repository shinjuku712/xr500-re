import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, Camera, VideoOff, Trash2, CheckCircle2, AlertTriangle, Radio } from 'lucide-react';
import type { PoopHazard } from '../types';
import { Ios26Slider, Ios26Toggle } from './IosControls';

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
  const [sensitivity, setSensitivity] = useState(28);
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
        if (lBase - lCur > sensitivity && lCur < 120) darkDiffPixels++;
      }
      const pct = Number(((darkDiffPixels / total) * 100).toFixed(2));
      setAnomalyPct(pct);
      if (pct >= 0.35 && pct <= 18.0 && !alertTriggered) {
        setAlertTriggered(true);
        onEmergencyHalt(`Floor anomaly detected (${pct}%) — paused & docking!`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [camActive, visionArmed, hasBaseline, sensitivity, alertTriggered, onEmergencyHalt]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-[#ff9f0a]/15 p-3.5 text-[13px] leading-relaxed text-[#ffd60a]">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-white">
          <ShieldAlert className="h-4 w-4 text-[#ff9f0a]" />
          Pet Hazard Shield
        </div>
        <span className="text-[#ebebf5]">
          XR500 uses 2D LiDAR (no front camera). Guard floors with instant No-Go Poop Pins, Pre-Flight Check, or Room Camera Vision.
        </span>
      </div>

      <div className="ios-group flex items-center justify-between px-4 py-3.5">
        <div>
          <div className="text-[14px] font-medium text-white">Pre-Flight Floor Check</div>
          <div className="text-[12px] text-[#c7c7cc]">Confirm floor is clear before starting</div>
        </div>
        <Ios26Toggle
          checked={preFlightGate}
          onChange={onTogglePreFlight}
          ariaLabel="Pre-Flight Floor Check"
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
            Active Poop Pins ({hazards.length})
          </span>
          <button
            onClick={onSelectPoopTool}
            className="rounded-full bg-[#ff9f0a] px-3 py-1 text-[12px] font-semibold text-black transition hover:bg-[#ffb340]"
          >
            + Drop Pin
          </button>
        </div>

        <div className="ios-group flex items-center justify-between gap-3.5 px-4 py-3.5">
          <span className="shrink-0 text-[13px] font-medium text-[#e5e5ea]">Buffer Radius</span>
          <Ios26Slider
            min={6}
            max={20}
            value={poopRadiusPx}
            onChange={onChangeRadius}
            accent="#ff9f0a"
            className="flex-1"
            ariaLabel="Buffer Radius"
          />
          <span className="w-12 shrink-0 text-right font-mono text-[13px] font-semibold text-white">
            {((poopRadiusPx * 5) / 100).toFixed(2)}m
          </span>
        </div>

        {hazards.length === 0 ? (
          <div className="ios-group py-3.5 text-center text-[13px] text-[#c7c7cc]">
            No active pet hazards marked.
          </div>
        ) : (
          <div className="ios-group divide-y divide-white/[0.06] overflow-hidden">
            {hazards.map((h) => (
              <div key={h.id} className="flex items-center justify-between px-4 py-3 text-[13px]">
                <div>
                  <span className="font-medium text-white">💩 {h.label}</span>
                  <span className="ml-2 font-mono text-[12px] text-[#c7c7cc]">
                    {h.created_at} · {((h.radius_px * 10) / 100).toFixed(1)}m
                  </span>
                </div>
                <button
                  onClick={() => onDeleteHazard(h.id)}
                  className="flex items-center gap-1 rounded-full bg-[#30d158]/20 px-3 py-1 text-[12px] font-semibold text-[#30d158] hover:bg-[#30d158]/30"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2.5 pt-1">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
            <Radio className={`h-3.5 w-3.5 ${visionArmed ? 'animate-pulse text-[#30d158]' : 'text-[#c7c7cc]'}`} />
            Camera Floor Watch
          </div>
          {!camActive ? (
            <button
              onClick={startCamera}
              className="flex items-center gap-1.5 rounded-full bg-[#2c2c2e] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#3a3a3c]"
            >
              <Camera className="h-3.5 w-3.5" /> Enable Cam
            </button>
          ) : (
            <button
              onClick={stopCamera}
              className="flex items-center gap-1 rounded-full bg-[#ff453a]/20 px-3 py-1.5 text-[12px] font-medium text-[#ff6961]"
            >
              <VideoOff className="h-3.5 w-3.5" /> Stop
            </button>
          )}
        </div>

        {camError && <p className="px-1 text-[12px] text-[#ff6961]">{camError}</p>}

        {camActive && (
          <div className="ios-group space-y-3 p-3">
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} muted playsInline className="h-36 w-full object-cover" />
              {alertTriggered && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#ff453a]/85 text-center">
                  <AlertTriangle className="mb-1 h-6 w-6 text-white" />
                  <div className="text-[13px] font-bold text-white">HAZARD DETECTED</div>
                  <div className="text-[12px] text-white/90">Paused & Returning to Dock</div>
                </div>
              )}
              <div className="absolute bottom-2 right-2 rounded-full bg-black/75 px-2.5 py-0.5 font-mono text-[11px] text-white">
                Blob: {anomalyPct}%
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={captureBaseline}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#3a3a3c] py-2.5 text-[13px] font-medium text-white hover:bg-[#48484a]"
              >
                <CheckCircle2 className="h-4 w-4 text-[#30d158]" />
                {hasBaseline ? 'Reset Floor' : 'Capture Clean Floor'}
              </button>
              <button
                disabled={!hasBaseline}
                onClick={() => {
                  setAlertTriggered(false);
                  setVisionArmed(!visionArmed);
                }}
                className={`rounded-xl px-4 py-2.5 text-[13px] font-semibold transition disabled:opacity-40 ${
                  visionArmed ? 'bg-[#30d158] text-black' : 'bg-[#0a84ff] text-white'
                }`}
              >
                {visionArmed ? 'Armed' : 'Arm'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 px-1 text-[13px] text-[#e5e5ea]">
              <span className="shrink-0 font-medium">Sensitivity</span>
              <Ios26Slider
                min={14}
                max={55}
                value={sensitivity}
                onChange={setSensitivity}
                accent="#30d158"
                className="flex-1"
                ariaLabel="Camera Sensitivity"
              />
              <span className="w-8 shrink-0 text-right font-mono font-semibold text-white">{sensitivity}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
