import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { CustomPlace, DraftZone, MapState, Room, TargetPin, ToolMode } from '../types';

interface HouseMapCanvasProps {
  mapState: MapState | null;
  toolMode: ToolMode;
  selectedRoomIds: number[];
  onToggleRoom: (roomId: number) => void;
  onEditRoom: (room: Room) => void;
  selectedPlaceIds: string[];
  onTogglePlace: (placeId: string) => void;
  onEditPlace: (place: CustomPlace) => void;
  onDraftNewPlace: (rect: { x1: number; y1: number; x2: number; y2: number }) => void;
  draftZones: DraftZone[];
  onAddDraftZone: (zone: Omit<DraftZone, 'id'>) => void;
  draftPin: TargetPin | null;
  spotClean: boolean;
  onSetDraftPin: (pin: TargetPin) => void;
  onAddNoGo: (x1: number, y1: number, x2: number, y2: number) => void;
  onAddVWall: (x1: number, y1: number, x2: number, y2: number) => void;
  onDropPoop: (x: number, y: number) => void;
  brushRadiusPx: number;
  fitTrigger: number;
  zoomDelta: { dir: number; seq: number };
  showGrid: boolean;
  showTrajectory: boolean;
}

// Refined, understated architectural room palette (matching the obsidian hardware studio aesthetic)
const STUDIO_COLORS: Record<string, [number, number, number]> = {
  '#38bdf8': [96, 165, 210],
  '#34d399': [92, 172, 146],
  '#fbbf24': [198, 162, 102],
  '#a78bfa': [150, 136, 206],
  '#f472b6': [196, 126, 158],
  '#2dd4bf': [88, 174, 168],
  '#fb7185': [200, 118, 134],
  '#60a5fa': [114, 152, 212],
};

function hexToRgb(hex: string): [number, number, number] {
  if (STUDIO_COLORS[hex.toLowerCase()]) return STUDIO_COLORS[hex.toLowerCase()];
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16) || 140,
    parseInt(clean.substring(2, 4), 16) || 170,
    parseInt(clean.substring(4, 6), 16) || 200,
  ];
}

export const HouseMapCanvas: React.FC<HouseMapCanvasProps> = ({
  mapState,
  toolMode,
  selectedRoomIds,
  onToggleRoom,
  onEditRoom,
  selectedPlaceIds,
  onTogglePlace,
  onEditPlace,
  onDraftNewPlace,
  draftZones,
  onAddDraftZone,
  draftPin,
  spotClean,
  onSetDraftPin,
  onAddNoGo,
  onAddVWall,
  onDropPoop,
  brushRadiusPx,
  fitTrigger,
  zoomDelta,
  showGrid,
  showTrajectory,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  // Smooth spring-interpolated camera (target vs current)
  const camRef = useRef({
    scale: 2.2,
    offsetX: 0,
    offsetY: 0,
    targetScale: 2.2,
    targetOffsetX: 0,
    targetOffsetY: 0,
    initialized: false,
    lastIsReal: false,
  });

  const smoothRobotRef = useRef({ x: 0, y: 0, heading: 0, init: false });

  const dragRef = useRef<{
    type: 'none' | 'pan' | 'zone' | 'place' | 'nogo' | 'vwall' | 'brush';
    startScreenX: number;
    startScreenY: number;
    startCamX: number;
    startCamY: number;
    startWX: number;
    startWY: number;
    curWX: number;
    curWY: number;
    brushPts: [number, number][];
  }>({
    type: 'none',
    startScreenX: 0,
    startScreenY: 0,
    startCamX: 0,
    startCamY: 0,
    startWX: 0,
    startWY: 0,
    curWX: 0,
    curWY: 0,
    brushPts: [],
  });

  const hoveredRoomIdRef = useRef<number | null>(null);
  const hoveredPlaceIdRef = useRef<string | null>(null);
  const [hoveredRoomId, setHoveredRoomId] = useState<number | null>(null);
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null);
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const [scaleBar, setScaleBar] = useState<{ label: string; px: number }>({ label: '1m', px: 60 });

  const slamGrid = useMemo(() => {
    const b64 = mapState?.floorplan?.grid_b64;
    if (!b64) return null;
    try {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    } catch {
      return null;
    }
  }, [mapState?.floorplan?.grid_b64]);

  // Architectural SLAM Bitmap Builder with crisp inter-room boundary edge detection
  useEffect(() => {
    const fp = mapState?.floorplan;
    if (!fp?.is_real_slam || !slamGrid || !fp.width || !fp.height) {
      offscreenRef.current = null;
      return;
    }

    const w = fp.width;
    const h = fp.height;
    let off = offscreenRef.current;
    if (!off) {
      off = document.createElement('canvas');
      offscreenRef.current = off;
    }
    if (off.width !== w || off.height !== h) {
      off.width = w;
      off.height = h;
    }

    const octx = off.getContext('2d');
    if (!octx) return;
    const img = octx.createImageData(w, h);
    const data = img.data;

    const roomColors = new Map<number, [number, number, number]>();
    for (const r of fp.rooms) roomColors.set(r.id, hexToRgb(r.color));
    const selSet = new Set(selectedRoomIds);

    for (let y = 0; y < h; y++) {
      const rowOff = y * w;
      for (let x = 0; x < w; x++) {
        const i = rowOff + x;
        const v = slamGrid[i];
        const o = i * 4;

        if (v === 255) {
          data[o + 3] = 0;
        } else if (v === 249) {
          // Crisp brushed-aluminum white wall
          data[o] = 236;
          data[o + 1] = 240;
          data[o + 2] = 245;
          data[o + 3] = 248;
        } else if (v === 244) {
          // Matte dark slate floor
          data[o] = 52;
          data[o + 1] = 56;
          data[o + 2] = 66;
          data[o + 3] = 148;
        } else if (v < 240 && (v & 3) === 0) {
          const rid = v >> 2;
          const [r, g, b] = roomColors.get(rid) || [126, 152, 184];
          const isSel = selSet.has(rid);
          const isHov = hoveredRoomId === rid;

          const left = x > 0 ? slamGrid[i - 1] : v;
          const top = y > 0 ? slamGrid[i - w] : v;
          const isBorder = (left !== v && left < 240) || (top !== v && top < 240);

          if (isBorder) {
            data[o] = Math.min(255, r + 55);
            data[o + 1] = Math.min(255, g + 55);
            data[o + 2] = Math.min(255, b + 55);
            data[o + 3] = isSel ? 235 : 135;
          } else {
            data[o] = r;
            data[o + 1] = g;
            data[o + 2] = b;
            data[o + 3] = isSel ? 132 : isHov ? 92 : 48;
          }
        } else {
          data[o] = 72;
          data[o + 1] = 76;
          data[o + 2] = 88;
          data[o + 3] = 105;
        }
      }
    }

    octx.putImageData(img, 0, 0);
  }, [mapState?.floorplan, slamGrid, selectedRoomIds, hoveredRoomId]);

  const propsRef = useRef({
    mapState,
    toolMode,
    selectedRoomIds,
    selectedPlaceIds,
    draftZones,
    draftPin,
    showGrid,
    showTrajectory,
    slamGrid,
    brushRadiusPx,
  });
  propsRef.current = {
    mapState,
    toolMode,
    selectedRoomIds,
    selectedPlaceIds,
    draftZones,
    draftPin,
    showGrid,
    showTrajectory,
    slamGrid,
    brushRadiusPx,
  };

  const isReal = Boolean(mapState?.floorplan?.is_real_slam);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const { scale, offsetX, offsetY } = camRef.current;
    const real = Boolean(propsRef.current.mapState?.floorplan?.is_real_slam);
    return {
      x: (sx - offsetX) / scale,
      y: real ? (sy - offsetY) / scale : -(sy - offsetY) / scale,
    };
  }, []);

  const fitToViewport = useCallback((instant = false) => {
    const el = containerRef.current;
    const fp = propsRef.current.mapState?.floorplan;
    if (!el || !fp) return;
    const rect = el.getBoundingClientRect();
    const { min_x, max_x, min_y, max_y } = fp.bounds;
    const worldW = Math.max(10, max_x - min_x);
    const worldH = Math.max(10, max_y - min_y);
    const padX = 130;
    const padY = 165;
    const scale = Math.max(
      0.35,
      Math.min(8.0, Math.min(Math.max(200, rect.width - padX) / worldW, Math.max(200, rect.height - padY) / worldH))
    );
    const centerWX = (min_x + max_x) / 2;
    const centerWY = (min_y + max_y) / 2;
    const real = Boolean(fp.is_real_slam);
    const targetOffsetX = rect.width / 2 - centerWX * scale;
    const targetOffsetY = real ? rect.height / 2 - centerWY * scale : rect.height / 2 + centerWY * scale;

    const cam = camRef.current;
    cam.targetScale = scale;
    cam.targetOffsetX = targetOffsetX;
    cam.targetOffsetY = targetOffsetY;
    cam.initialized = true;
    cam.lastIsReal = real;

    if (instant) {
      cam.scale = scale;
      cam.offsetX = targetOffsetX;
      cam.offsetY = targetOffsetY;
    }
  }, []);

  useEffect(() => {
    if (
      mapState?.floorplan &&
      (!camRef.current.initialized || camRef.current.lastIsReal !== Boolean(mapState.floorplan.is_real_slam))
    ) {
      fitToViewport(true);
    }
  }, [mapState?.floorplan, fitToViewport]);

  useEffect(() => {
    if (fitTrigger > 0) fitToViewport(false);
  }, [fitTrigger, fitToViewport]);

  useEffect(() => {
    if (zoomDelta.seq === 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const factor = zoomDelta.dir > 0 ? 1.28 : 1 / 1.28;
    const cam = camRef.current;
    const newScale = Math.max(0.35, Math.min(10.0, cam.targetScale * factor));
    const ratio = newScale / cam.targetScale;
    cam.targetOffsetX = cx - (cx - cam.targetOffsetX) * ratio;
    cam.targetOffsetY = cy - (cy - cam.targetOffsetY) * ratio;
    cam.targetScale = newScale;
  }, [zoomDelta]);

  // 60fps Studio Render Loop
  useEffect(() => {
    let rafId = 0;
    let lastScaleBarScale = -1;

    const render = (now: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafId = requestAnimationFrame(render);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      // Smooth spring camera interpolation
      const cam = camRef.current;
      if (dragRef.current.type !== 'pan') {
        cam.scale += (cam.targetScale - cam.scale) * 0.2;
        cam.offsetX += (cam.targetOffsetX - cam.offsetX) * 0.2;
        cam.offsetY += (cam.targetOffsetY - cam.offsetY) * 0.2;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafId = requestAnimationFrame(render);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const W = rect.width;
      const H = rect.height;
      const {
        mapState: ms,
        selectedRoomIds: selIds,
        selectedPlaceIds: selPlaceIds,
        draftZones: dZones,
        draftPin: dPin,
        showGrid: sGrid,
        showTrajectory: sTraj,
        brushRadiusPx: bRad,
      } = propsRef.current;

      const real = Boolean(ms?.floorplan?.is_real_slam);
      const resCm = ms?.floorplan?.resolution_cm || 5;
      const unitM = real ? resCm / 100.0 : 0.01;

      // Update dynamic metric CAD scale bar only when zoom changes noticeably
      if (Math.abs(cam.scale - lastScaleBarScale) > 0.04) {
        lastScaleBarScale = cam.scale;
        const pxPerMeter = cam.scale / unitM;
        const candidates = [0.5, 1, 2, 5, 10];
        let best = 1;
        for (const m of candidates) {
          if (m * pxPerMeter >= 48 && m * pxPerMeter <= 130) {
            best = m;
            break;
          }
        }
        setScaleBar({ label: best < 1 ? `${best * 100}cm` : `${best}m`, px: Math.round(best * pxPerMeter) });
      }

      // 1. True iOS OLED matte-black canvas with ultra-subtle radial lift
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.48, 30, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
      bg.addColorStop(0, '#0c0c0e');
      bg.addColorStop(1, '#000000');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const w2s = (wx: number, wy: number) => ({
        x: wx * cam.scale + cam.offsetX,
        y: real ? wy * cam.scale + cam.offsetY : -wy * cam.scale + cam.offsetY,
      });

      // 2. Subtle architectural CAD hairline grid (1m intervals)
      if (sGrid) {
        const step = real ? 20 : 100;
        const pTL = screenToWorld(0, 0);
        const pBR = screenToWorld(W, H);
        const minX = Math.min(pTL.x, pBR.x);
        const maxX = Math.max(pTL.x, pBR.x);
        const minY = Math.min(pTL.y, pBR.y);
        const maxY = Math.max(pTL.y, pBR.y);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.028)';
        ctx.lineWidth = 1;
        for (let x = Math.floor(minX / step) * step; x <= maxX; x += step) {
          const sx = Math.round(x * cam.scale + cam.offsetX) + 0.5;
          ctx.beginPath();
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, H);
          ctx.stroke();
        }
        for (let y = Math.floor(minY / step) * step; y <= maxY; y += step) {
          const sy = Math.round(real ? y * cam.scale + cam.offsetY : -y * cam.scale + cam.offsetY) + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, sy);
          ctx.lineTo(W, sy);
          ctx.stroke();
        }
      }

      if (!ms) {
        ctx.restore();
        rafId = requestAnimationFrame(render);
        return;
      }

      const { floorplan, robot, trajectory } = ms;

      // 3. Real SLAM Floorplan Bitmap with crisp architectural drop shadow
      if (real && offscreenRef.current && floorplan.width && floorplan.height) {
        const tl = w2s(0, 0);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = 32;
        ctx.shadowOffsetY = 8;
        ctx.drawImage(offscreenRef.current, tl.x, tl.y, floorplan.width * cam.scale, floorplan.height * cam.scale);
        ctx.restore();
      }

      // 4. Permanent Custom Places (e.g. "Corridor")
      for (const pl of floorplan.custom_places || []) {
        const a = w2s(pl.x1, pl.y1);
        const b = w2s(pl.x2, pl.y2);
        const rx = Math.min(a.x, b.x);
        const ry = Math.min(a.y, b.y);
        const rw = Math.abs(b.x - a.x);
        const rh = Math.abs(b.y - a.y);
        const selIdx = selPlaceIds.indexOf(pl.id);
        const isSel = selIdx !== -1;
        const isHov = hoveredPlaceIdRef.current === pl.id;
        const [cr, cg, cb] = hexToRgb(pl.color || '#38bdf8');

        ctx.save();
        ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${isSel ? 0.30 : isHov ? 0.22 : 0.12})`;
        ctx.strokeStyle = isSel
          ? '#7dd3fc'
          : `rgba(${cr}, ${cg}, ${cb}, ${isHov ? 0.9 : 0.65})`;
        ctx.lineWidth = isSel ? 2 : 1.25;
        if (isSel) {
          ctx.shadowColor = 'rgba(56, 189, 248, 0.45)';
          ctx.shadowBlur = 14;
        }
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, 6);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Clean frosted label pill
        const cx = rx + rw / 2;
        const cy = ry + rh / 2;
        ctx.font = '600 11px Inter, sans-serif';
        const tw = ctx.measureText(pl.name).width;
        const badgeW = isSel ? 18 : 0;
        const pillW = tw + badgeW + 18;
        const pillH = 22;
        const px = cx - pillW / 2;
        const py = cy - pillH / 2;

        ctx.fillStyle = isSel ? '#fafafa' : 'rgba(9, 11, 16, 0.82)';
        ctx.strokeStyle = isSel ? '#fafafa' : `rgba(${cr}, ${cg}, ${cb}, 0.55)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(px, py, pillW, pillH, 999);
        ctx.fill();
        ctx.stroke();

        if (isSel) {
          ctx.fillStyle = '#09090b';
          ctx.beginPath();
          ctx.arc(px + 11, cy, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fafafa';
          ctx.font = '700 9.5px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(selIdx + 1), px + 11, cy + 0.5);
        }

        ctx.fillStyle = isSel ? '#09090b' : '#f4f4f5';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(pl.name, px + (isSel ? 22 : 9), cy);
        ctx.restore();
      }

      // 5. No-Go Zones
      for (const ng of floorplan.no_go_zones || []) {
        const a = w2s(ng.x1, ng.y1);
        const b = w2s(ng.x2, ng.y2);
        const rx = Math.min(a.x, b.x);
        const ry = Math.min(a.y, b.y);
        const rw = Math.abs(b.x - a.x);
        const rh = Math.abs(b.y - a.y);

        ctx.save();
        ctx.fillStyle = 'rgba(244, 63, 94, 0.14)';
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.78)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
        if (rw > 36) {
          ctx.fillStyle = '#fda4af';
          ctx.font = '600 9.5px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('NO-GO', rx + rw / 2, ry + rh / 2);
        }
        ctx.restore();
      }

      // 6. Poop / Pet Hazard Bubbles
      for (const hz of floorplan.poop_hazards || []) {
        const c = w2s(hz.x, hz.y);
        const rScreen = hz.radius_px * cam.scale;
        const pulse = (Math.sin(now * 0.004) + 1) / 2;

        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(c.x - rScreen, c.y - rScreen, rScreen * 2, rScreen * 2);
        ctx.setLineDash([]);

        const grad = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, rScreen);
        grad.addColorStop(0, 'rgba(245, 158, 11, 0.34)');
        grad.addColorStop(1, 'rgba(245, 158, 11, 0.03)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rScreen + pulse * 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💩', c.x, c.y);
        ctx.restore();
      }

      // 7. Virtual Walls
      for (const vw of floorplan.virtual_walls || []) {
        const a = w2s(vw.x1, vw.y1);
        const b = w2s(vw.x2, vw.y2);
        ctx.save();
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
      }

      // 8. Live Ice-Blue Trajectory Trail (HoSLAM Port 9999)
      if (sTraj && trajectory.length > 1) {
        ctx.save();
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.42)';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(56, 189, 248, 0.35)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        trajectory.forEach(([tx, ty], i) => {
          const p = w2s(tx, ty);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.restore();
      }

      // 9. Draft Cleaning Zones & Active Tool Previews
      const drawZoneRect = (x1: number, y1: number, x2: number, y2: number, label: string) => {
        const a = w2s(x1, y1);
        const b = w2s(x2, y2);
        const rx = Math.min(a.x, b.x);
        const ry = Math.min(a.y, b.y);
        const rw = Math.abs(b.x - a.x);
        const rh = Math.abs(b.y - a.y);

        ctx.save();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -(now * 0.02);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
        ctx.restore();

        const wM = (Math.abs(x2 - x1) * unitM).toFixed(2);
        const hM = (Math.abs(y2 - y1) * unitM).toFixed(2);
        const text = `${label} · ${wM}×${hM}m`;
        ctx.save();
        ctx.font = '500 10.5px JetBrains Mono, monospace';
        const tw = ctx.measureText(text).width + 14;
        const tx = rx + rw / 2 - tw / 2;
        const ty = ry - 24;
        ctx.fillStyle = 'rgba(9, 11, 16, 0.88)';
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
        ctx.beginPath();
        ctx.roundRect(tx, ty, tw, 19, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#e0f2fe';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tx + tw / 2, ty + 9.5);
        ctx.restore();
      };

      dZones.forEach((z, idx) =>
        drawZoneRect(z.x1, z.y1, z.x2, z.y2, z.source === 'brush' ? `Spot ${idx + 1}` : `Zone ${idx + 1}`)
      );

      const drag = dragRef.current;
      if (drag.type === 'zone') {
        drawZoneRect(drag.startWX, drag.startWY, drag.curWX, drag.curWY, 'New Zone');
      } else if (drag.type === 'place') {
        drawZoneRect(drag.startWX, drag.startWY, drag.curWX, drag.curWY, 'New Place');
      } else if (drag.type === 'brush' && drag.brushPts.length > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
        ctx.lineWidth = bRad * 2 * cam.scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        drag.brushPts.forEach(([bx, by], i) => {
          const p = w2s(bx, by);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.restore();
      } else if (drag.type === 'nogo') {
        const a = w2s(drag.startWX, drag.startWY);
        const b = w2s(drag.curWX, drag.curWY);
        ctx.save();
        ctx.fillStyle = 'rgba(244, 63, 94, 0.22)';
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.75;
        ctx.setLineDash([5, 4]);
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.restore();
      } else if (drag.type === 'vwall') {
        const a = w2s(drag.startWX, drag.startWY);
        const b = w2s(drag.curWX, drag.curWY);
        ctx.save();
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
      }

      // 10. Clean Architectural Room Labels
      for (const room of floorplan.rooms) {
        const lp = w2s(room.label_pos[0], room.label_pos[1]);
        const selIndex = selIds.indexOf(room.id);
        const isSelected = selIndex !== -1;

        ctx.save();
        ctx.font = '500 11.5px Inter, sans-serif';
        const nameW = ctx.measureText(room.name).width;
        const badgeW = isSelected ? 20 : 0;
        const pillW = nameW + badgeW + 20;
        const pillH = 24;
        const px = lp.x - pillW / 2;
        const py = lp.y - pillH / 2;

        ctx.fillStyle = isSelected ? 'rgba(250, 250, 250, 0.96)' : 'rgba(10, 12, 18, 0.68)';
        ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.13)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(px, py, pillW, pillH, 999);
        ctx.fill();
        ctx.stroke();

        if (isSelected) {
          ctx.fillStyle = '#09090b';
          ctx.beginPath();
          ctx.arc(px + 12, lp.y, 7.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fafafa';
          ctx.font = '700 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(selIndex + 1), px + 12, lp.y + 0.5);
        }

        ctx.fillStyle = isSelected ? '#09090b' : '#f4f4f5';
        ctx.font = '500 11.5px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(room.name, px + (isSelected ? 24 : 10), lp.y);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.44)';
        ctx.font = '500 9.5px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${room.area_m2}m²`, lp.x, lp.y + 19);
        ctx.restore();
      }

      // 11. Target Pin
      const activePin = dPin || robot.target_pin;
      if (activePin) {
        const pp = w2s(activePin.x, activePin.y);
        const pulse = (Math.sin(now * 0.005) + 1) / 2;
        ctx.save();
        ctx.strokeStyle = activePin.spot_clean ? '#fbbf24' : '#7dd3fc';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 9 + pulse * 12, 0, Math.PI * 2);
        ctx.globalAlpha = 0.65 - pulse * 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = activePin.spot_clean ? '#fbbf24' : '#7dd3fc';
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 12. Charging Dock
      const dp = w2s(floorplan.dock.x, floorplan.dock.y);
      ctx.save();
      ctx.fillStyle = 'rgba(52, 211, 153, 0.14)';
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#090b10';
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#34d399';
      ctx.font = '700 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡', dp.x, dp.y + 0.5);
      ctx.restore();

      // 13. Studio-Grade Matte-Black LiDAR Robot Vacuum + Volumetric Laser Sweep
      const sr = smoothRobotRef.current;
      if (!sr.init) {
        sr.x = robot.x;
        sr.y = robot.y;
        sr.heading = robot.heading || 0;
        sr.init = true;
      } else {
        sr.x += (robot.x - sr.x) * 0.18;
        sr.y += (robot.y - sr.y) * 0.18;
        let dh = (robot.heading || 0) - sr.heading;
        while (dh > 180) dh -= 360;
        while (dh < -180) dh += 360;
        sr.heading += dh * 0.18;
      }

      const rp = w2s(sr.x, sr.y);
      const rRad = 12.5;
      const headRad = (sr.heading * Math.PI) / 180;

      ctx.save();
      ctx.translate(rp.x, rp.y);

      // Subtle volumetric ice-blue LiDAR laser fan (matches the README hero banner!)
      const sweepAngle = robot.is_moving ? (now * 0.0038) % (Math.PI * 2) : headRad - 0.35;
      const fanRadius = robot.is_moving ? rRad * 5.2 : rRad * 3.0;
      const fanGrad = ctx.createRadialGradient(0, 0, rRad * 0.4, 0, 0, fanRadius);
      fanGrad.addColorStop(0, robot.is_moving ? 'rgba(125, 211, 252, 0.38)' : 'rgba(125, 211, 252, 0.14)');
      fanGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
      ctx.fillStyle = fanGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, fanRadius, sweepAngle, sweepAngle + 0.72);
      ctx.closePath();
      ctx.fill();

      ctx.rotate(headRad);

      // Matte obsidian chassis with brushed aluminum bevel
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 14;
      const bodyGrad = ctx.createLinearGradient(-rRad, -rRad, rRad, rRad);
      bodyGrad.addColorStop(0, '#27272a');
      bodyGrad.addColorStop(1, '#09090b');
      ctx.fillStyle = bodyGrad;
      ctx.strokeStyle = robot.is_moving ? '#7dd3fc' : 'rgba(244, 244, 245, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, rRad, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Front bumper directional arc
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, rRad - 2.5, -0.65, 0.65);
      ctx.stroke();

      // Offset raised LiDAR turret dome
      ctx.fillStyle = '#18181b';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(-2.5, 0, 4.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Center LiDAR emitter dot
      ctx.fillStyle = robot.is_moving ? '#38bdf8' : '#34d399';
      ctx.beginPath();
      ctx.arc(-2.5, 0, 1.7, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      ctx.restore();
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [screenToWorld]);

  const hitTestPlace = useCallback((wx: number, wy: number): CustomPlace | null => {
    const places = propsRef.current.mapState?.floorplan?.custom_places || [];
    for (let i = places.length - 1; i >= 0; i--) {
      const p = places[i];
      if (wx >= p.x1 && wx <= p.x2 && wy >= p.y1 && wy <= p.y2) return p;
    }
    return null;
  }, []);

  const hitTestRoom = useCallback((wx: number, wy: number): Room | null => {
    const fp = propsRef.current.mapState?.floorplan;
    if (!fp || !fp.is_real_slam || !propsRef.current.slamGrid || !fp.width || !fp.height) return null;
    const col = Math.floor(wx);
    const row = Math.floor(wy);
    if (col >= 0 && col < fp.width && row >= 0 && row < fp.height) {
      const v = propsRef.current.slamGrid[row * fp.width + col];
      if (v < 240 && (v & 3) === 0) {
        const rid = v >> 2;
        return fp.rooms.find((r) => r.id === rid) || null;
      }
    }
    return null;
  }, []);

  const getLocalCoords = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const { sx, sy } = getLocalCoords(e);
    const cam = camRef.current;
    const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
    const newScale = Math.max(0.35, Math.min(10.0, cam.targetScale * factor));
    const ratio = newScale / cam.targetScale;
    cam.targetOffsetX = sx - (sx - cam.targetOffsetX) * ratio;
    cam.targetOffsetY = sy - (sy - cam.targetOffsetY) * ratio;
    cam.targetScale = newScale;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const { sx, sy } = getLocalCoords(e);
    const w = screenToWorld(sx, sy);

    if (e.button === 1 || e.altKey || toolMode === 'pan') {
      dragRef.current = {
        type: 'pan',
        startScreenX: sx,
        startScreenY: sy,
        startCamX: camRef.current.offsetX,
        startCamY: camRef.current.offsetY,
        startWX: w.x,
        startWY: w.y,
        curWX: w.x,
        curWY: w.y,
        brushPts: [],
      };
      return;
    }
    if (e.button !== 0) return;

    if (toolMode === 'zone' || toolMode === 'place' || toolMode === 'nogo' || toolMode === 'vwall') {
      dragRef.current = {
        type: toolMode,
        startScreenX: sx,
        startScreenY: sy,
        startCamX: 0,
        startCamY: 0,
        startWX: w.x,
        startWY: w.y,
        curWX: w.x,
        curWY: w.y,
        brushPts: [],
      };
    } else if (toolMode === 'brush') {
      dragRef.current = {
        type: 'brush',
        startScreenX: sx,
        startScreenY: sy,
        startCamX: 0,
        startCamY: 0,
        startWX: w.x,
        startWY: w.y,
        curWX: w.x,
        curWY: w.y,
        brushPts: [[w.x, w.y]],
      };
    } else if (toolMode === 'pin') {
      onSetDraftPin({ x: Math.round(w.x), y: Math.round(w.y), spot_clean: spotClean });
    } else if (toolMode === 'poop') {
      onDropPoop(Math.round(w.x), Math.round(w.y));
    } else if (toolMode === 'rooms') {
      const hitPlace = hitTestPlace(w.x, w.y);
      if (hitPlace) {
        onTogglePlace(hitPlace.id);
        return;
      }
      const hit = hitTestRoom(w.x, w.y);
      if (hit) {
        onToggleRoom(hit.id);
      } else {
        dragRef.current = {
          type: 'pan',
          startScreenX: sx,
          startScreenY: sy,
          startCamX: camRef.current.offsetX,
          startCamY: camRef.current.offsetY,
          startWX: w.x,
          startWY: w.y,
          curWX: w.x,
          curWY: w.y,
          brushPts: [],
        };
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { sx, sy } = getLocalCoords(e);
    const w = screenToWorld(sx, sy);
    setCursorWorld({ x: w.x, y: w.y });

    const drag = dragRef.current;
    if (drag.type === 'pan') {
      const nx = drag.startCamX + (sx - drag.startScreenX);
      const ny = drag.startCamY + (sy - drag.startScreenY);
      camRef.current.offsetX = nx;
      camRef.current.offsetY = ny;
      camRef.current.targetOffsetX = nx;
      camRef.current.targetOffsetY = ny;
      return;
    }
    if (drag.type === 'brush') {
      drag.brushPts.push([w.x, w.y]);
      return;
    }
    if (drag.type === 'zone' || drag.type === 'place' || drag.type === 'nogo' || drag.type === 'vwall') {
      drag.curWX = w.x;
      drag.curWY = w.y;
      return;
    }

    const hitPlace = hitTestPlace(w.x, w.y);
    if (hitPlace) {
      hoveredPlaceIdRef.current = hitPlace.id;
      if (hoveredRoomIdRef.current !== null) {
        hoveredRoomIdRef.current = null;
        setHoveredRoomId(null);
      }
      setHoveredLabel(`${hitPlace.name} · Custom Place`);
      return;
    }
    hoveredPlaceIdRef.current = null;

    const hit = hitTestRoom(w.x, w.y);
    const nextId = hit ? hit.id : null;
    if (hoveredRoomIdRef.current !== nextId) {
      hoveredRoomIdRef.current = nextId;
      setHoveredRoomId(nextId);
      setHoveredLabel(hit ? `${hit.name} · ${hit.area_m2}m²` : null);
    }
  };

  const handleMouseUp = () => {
    const drag = dragRef.current;
    const dist = Math.hypot(drag.curWX - drag.startWX, drag.curWY - drag.startWY);
    const minDrag = isReal ? 4 : 20;

    if (drag.type === 'zone' && dist > minDrag) {
      onAddDraftZone({
        x1: Math.round(Math.min(drag.startWX, drag.curWX)),
        y1: Math.round(Math.min(drag.startWY, drag.curWY)),
        x2: Math.round(Math.max(drag.startWX, drag.curWX)),
        y2: Math.round(Math.max(drag.startWY, drag.curWY)),
        passes: 1,
        source: 'rect',
      });
    } else if (drag.type === 'place' && dist > minDrag) {
      onDraftNewPlace({
        x1: Math.round(Math.min(drag.startWX, drag.curWX)),
        y1: Math.round(Math.min(drag.startWY, drag.curWY)),
        x2: Math.round(Math.max(drag.startWX, drag.curWX)),
        y2: Math.round(Math.max(drag.startWY, drag.curWY)),
      });
    } else if (drag.type === 'brush' && drag.brushPts.length > 0) {
      const xs = drag.brushPts.map((p) => p[0]);
      const ys = drag.brushPts.map((p) => p[1]);
      onAddDraftZone({
        x1: Math.round(Math.min(...xs) - brushRadiusPx),
        y1: Math.round(Math.min(...ys) - brushRadiusPx),
        x2: Math.round(Math.max(...xs) + brushRadiusPx),
        y2: Math.round(Math.max(...ys) + brushRadiusPx),
        passes: 2,
        source: 'brush',
      });
    } else if (drag.type === 'nogo' && dist > minDrag) {
      onAddNoGo(drag.startWX, drag.startWY, drag.curWX, drag.curWY);
    } else if (drag.type === 'vwall' && dist > minDrag) {
      onAddVWall(drag.startWX, drag.startWY, drag.curWX, drag.curWY);
    }

    dragRef.current.type = 'none';
    dragRef.current.brushPts = [];
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (toolMode !== 'rooms') return;
    const { sx, sy } = getLocalCoords(e);
    const w = screenToWorld(sx, sy);
    const hitPlace = hitTestPlace(w.x, w.y);
    if (hitPlace) {
      onEditPlace(hitPlace);
      return;
    }
    const hit = hitTestRoom(w.x, w.y);
    if (hit) onEditRoom(hit);
  };

  const resCm = mapState?.floorplan?.resolution_cm || 5;
  const unitM = isReal ? resCm / 100.0 : 0.01;

  const cursorClass =
    toolMode === 'pan'
      ? 'cursor-grab active:cursor-grabbing'
      : toolMode === 'rooms'
      ? hoveredLabel
        ? 'cursor-pointer'
        : 'cursor-default'
      : 'cursor-crosshair';

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`block h-full w-full ${cursorClass}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      />

      {/* Bottom-Left Metric Scale Bar & Live Coordinates (Borderless iOS Pill, WCAG AAA) */}
      <div className="pointer-events-none fixed bottom-5 left-5 z-20 hidden items-center gap-2.5 sm:flex">
        <div className="ios-pill flex items-center gap-3 rounded-full px-3.5 py-2">
          {/* Dynamic Metric Scale Ruler */}
          <div className="flex items-center gap-2">
            <div
              className="h-1.5 border-b border-l border-r border-[#c7c7cc]"
              style={{ width: `${scaleBar.px}px` }}
            />
            <span className="font-mono text-[11px] font-medium text-[#e5e5ea]">{scaleBar.label}</span>
          </div>

          {cursorWorld && (
            <span className="font-mono text-[11px] text-[#c7c7cc]">
              {(cursorWorld.x * unitM).toFixed(2)}m, {(cursorWorld.y * unitM).toFixed(2)}m
            </span>
          )}

          {isReal && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-[#64d2ff]">
              <span className="h-2 w-2 rounded-full bg-[#30d158]" />
              HoSLAM 1Hz
            </span>
          )}
        </div>

        {hoveredLabel && toolMode === 'rooms' && (
          <div className="ios-pill rounded-full px-3.5 py-2 text-[12px] font-medium text-white">
            {hoveredLabel} <span className="text-[#c7c7cc]">· double-click to edit</span>
          </div>
        )}
      </div>
    </div>
  );
};
