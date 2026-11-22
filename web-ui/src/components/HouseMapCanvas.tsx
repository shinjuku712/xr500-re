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

// Refined, architectural muted palette (no harsh neon)
const ARCHITECTURAL_COLORS: Record<string, [number, number, number]> = {
  '#38bdf8': [116, 175, 214],
  '#34d399': [110, 184, 158],
  '#fbbf24': [214, 175, 110],
  '#a78bfa': [162, 146, 214],
  '#f472b6': [212, 134, 168],
  '#2dd4bf': [102, 186, 178],
  '#fb7185': [214, 128, 142],
  '#60a5fa': [126, 162, 220],
};

function hexToRgb(hex: string): [number, number, number] {
  if (ARCHITECTURAL_COLORS[hex.toLowerCase()]) return ARCHITECTURAL_COLORS[hex.toLowerCase()];
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

  const camRef = useRef({ scale: 2.2, offsetX: 0, offsetY: 0, initialized: false, lastIsReal: false });
  const smoothRobotRef = useRef({ x: 0, y: 0, init: false });

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
  const [hoveredRoomName, setHoveredRoomName] = useState<string | null>(null);

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

  // Architectural SLAM Bitmap Renderer with crisp inter-room boundary edge detection!
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
          // Razor-sharp warm-white architectural wall
          data[o] = 244;
          data[o + 1] = 244;
          data[o + 2] = 245;
          data[o + 3] = 250;
        } else if (v === 244) {
          // Subtle matte neutral floor/carpet
          data[o] = 63;
          data[o + 1] = 63;
          data[o + 2] = 70;
          data[o + 3] = 145;
        } else if (v < 240 && (v & 3) === 0) {
          const rid = v >> 2;
          const [r, g, b] = roomColors.get(rid) || [148, 163, 184];
          const isSel = selSet.has(rid);
          const isHov = hoveredRoomId === rid;

          // Edge detection: highlight crisp room partition borders
          const left = x > 0 ? slamGrid[i - 1] : v;
          const top = y > 0 ? slamGrid[i - w] : v;
          const isBorder = (left !== v && left < 240) || (top !== v && top < 240);

          if (isBorder) {
            data[o] = Math.min(255, r + 45);
            data[o + 1] = Math.min(255, g + 45);
            data[o + 2] = Math.min(255, b + 45);
            data[o + 3] = isSel ? 230 : 140;
          } else {
            data[o] = r;
            data[o + 1] = g;
            data[o + 2] = b;
            data[o + 3] = isSel ? 135 : isHov ? 96 : 54;
          }
        } else {
          data[o] = 82;
          data[o + 1] = 82;
          data[o + 2] = 91;
          data[o + 3] = 110;
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

  const fitToViewport = useCallback(() => {
    const el = containerRef.current;
    const fp = propsRef.current.mapState?.floorplan;
    if (!el || !fp) return;
    const rect = el.getBoundingClientRect();
    const { min_x, max_x, min_y, max_y } = fp.bounds;
    const worldW = Math.max(10, max_x - min_x);
    const worldH = Math.max(10, max_y - min_y);
    const padX = 140;
    const padY = 160;
    const scale = Math.min(Math.max(200, rect.width - padX) / worldW, Math.max(200, rect.height - padY) / worldH);
    const centerWX = (min_x + max_x) / 2;
    const centerWY = (min_y + max_y) / 2;
    const real = Boolean(fp.is_real_slam);

    camRef.current = {
      scale: Math.max(0.35, Math.min(8.0, scale)),
      offsetX: rect.width / 2 - centerWX * scale,
      offsetY: real ? rect.height / 2 - centerWY * scale : rect.height / 2 + centerWY * scale,
      initialized: true,
      lastIsReal: real,
    };
  }, []);

  useEffect(() => {
    if (
      mapState?.floorplan &&
      (!camRef.current.initialized || camRef.current.lastIsReal !== Boolean(mapState.floorplan.is_real_slam))
    ) {
      fitToViewport();
    }
  }, [mapState?.floorplan, fitToViewport]);

  useEffect(() => {
    if (fitTrigger > 0) fitToViewport();
  }, [fitTrigger, fitToViewport]);

  useEffect(() => {
    if (zoomDelta.seq === 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const factor = zoomDelta.dir > 0 ? 1.25 : 1 / 1.25;
    const cam = camRef.current;
    const newScale = Math.max(0.3, Math.min(10.0, cam.scale * factor));
    const ratio = newScale / cam.scale;
    cam.offsetX = cx - (cx - cam.offsetX) * ratio;
    cam.offsetY = cy - (cy - cam.offsetY) * ratio;
    cam.scale = newScale;
  }, [zoomDelta]);

  // 60fps Canvas Render Loop
  useEffect(() => {
    let rafId = 0;

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

      // 1. Matte obsidian canvas background (zero muddy blue)
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, W, H);

      const cam = camRef.current;
      const real = Boolean(ms?.floorplan?.is_real_slam);
      const resCm = ms?.floorplan?.resolution_cm || 5;
      const unitM = real ? resCm / 100.0 : 0.01;

      const w2s = (wx: number, wy: number) => ({
        x: wx * cam.scale + cam.offsetX,
        y: real ? wy * cam.scale + cam.offsetY : -wy * cam.scale + cam.offsetY,
      });

      // 2. Ultra-subtle dot / hairline CAD grid
      if (sGrid) {
        const step = real ? 20 : 100; // 1.0 meter
        const pTL = screenToWorld(0, 0);
        const pBR = screenToWorld(W, H);
        const minX = Math.min(pTL.x, pBR.x);
        const maxX = Math.max(pTL.x, pBR.x);
        const minY = Math.min(pTL.y, pBR.y);
        const maxY = Math.max(pTL.y, pBR.y);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.032)';
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

      // 3. REAL SLAM FLOORPLAN BITMAP
      if (real && offscreenRef.current && floorplan.width && floorplan.height) {
        const tl = w2s(0, 0);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        ctx.shadowBlur = 24;
        ctx.drawImage(offscreenRef.current, tl.x, tl.y, floorplan.width * cam.scale, floorplan.height * cam.scale);
        ctx.restore();
      }

      // 3b. Permanent Custom Places (e.g. "Corridor" spanning multiple rooms!)
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
        const [cr, cg, cb] = hexToRgb(pl.color || '#e2e8f0');

        ctx.save();
        ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${isSel ? 0.34 : isHov ? 0.24 : 0.14})`;
        ctx.strokeStyle = isSel
          ? '#ffffff'
          : `rgba(${cr}, ${cg}, ${cb}, ${isHov ? 0.95 : 0.7})`;
        ctx.lineWidth = isSel ? 2 : 1.35;
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, 6);
        ctx.fill();
        ctx.stroke();

        // Frosted pill label centered on the Custom Place
        const cx = rx + rw / 2;
        const cy = ry + rh / 2;
        ctx.font = '600 11px Inter, sans-serif';
        const labelText = pl.name;
        const tw = ctx.measureText(labelText).width;
        const badgeW = isSel ? 18 : 0;
        const pillW = tw + badgeW + 18;
        const pillH = 22;
        const px = cx - pillW / 2;
        const py = cy - pillH / 2;

        ctx.fillStyle = isSel ? '#ffffff' : 'rgba(9, 9, 11, 0.78)';
        ctx.strokeStyle = isSel ? '#ffffff' : `rgba(${cr}, ${cg}, ${cb}, 0.65)`;
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
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 9.5px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(selIdx + 1), px + 11, cy + 0.5);
        }

        ctx.fillStyle = isSel ? '#09090b' : '#f4f4f5';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, px + (isSel ? 22 : 9), cy);
        ctx.restore();
      }

      // 4. Persisted No-Go Zones
      for (const ng of floorplan.no_go_zones || []) {
        const a = w2s(ng.x1, ng.y1);
        const b = w2s(ng.x2, ng.y2);
        const rx = Math.min(a.x, b.x);
        const ry = Math.min(a.y, b.y);
        const rw = Math.abs(b.x - a.x);
        const rh = Math.abs(b.y - a.y);

        ctx.save();
        ctx.fillStyle = 'rgba(244, 63, 94, 0.14)';
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.75)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
        if (rw > 34) {
          ctx.fillStyle = '#fda4af';
          ctx.font = '600 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('NO-GO', rx + rw / 2, ry + rh / 2);
        }
        ctx.restore();
      }

      // 5. Persisted Poop / Pet Hazard Bubbles (synced to DP 15 0x1A!)
      for (const hz of floorplan.poop_hazards || []) {
        const c = w2s(hz.x, hz.y);
        const rScreen = hz.radius_px * cam.scale;
        const pulse = (Math.sin(now * 0.004) + 1) / 2;

        ctx.save();
        // Exclusion square outline (what DP 15 0x1A enforces)
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(c.x - rScreen, c.y - rScreen, rScreen * 2, rScreen * 2);
        ctx.setLineDash([]);

        // Hazard radial warning zone
        const grad = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, rScreen);
        grad.addColorStop(0, 'rgba(245, 158, 11, 0.35)');
        grad.addColorStop(1, 'rgba(245, 158, 11, 0.04)');
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

      // 6. Persisted Virtual Walls
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

      // 7. Real Cleaning Trajectory Trail (subtle crisp white-silver spline)
      if (sTraj && trajectory.length > 1) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 1.35;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        trajectory.forEach(([tx, ty], i) => {
          const p = w2s(tx, ty);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.restore();
      }

      // 8. Draft Cleaning Zones (from Rect or Brush Paint)
      const drawZoneRect = (x1: number, y1: number, x2: number, y2: number, label: string) => {
        const a = w2s(x1, y1);
        const b = w2s(x2, y2);
        const rx = Math.min(a.x, b.x);
        const ry = Math.min(a.y, b.y);
        const rw = Math.abs(b.x - a.x);
        const rh = Math.abs(b.y - a.y);

        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.11)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
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
        ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.roundRect(tx, ty, tw, 19, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f4f4f5';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tx + tw / 2, ty + 9.5);
        ctx.restore();
      };

      dZones.forEach((z, idx) => drawZoneRect(z.x1, z.y1, z.x2, z.y2, z.source === 'brush' ? `Spot ${idx + 1}` : `Zone ${idx + 1}`));

      const drag = dragRef.current;
      if (drag.type === 'zone') {
        drawZoneRect(drag.startWX, drag.startWY, drag.curWX, drag.curWY, 'New Zone');
      } else if (drag.type === 'place') {
        drawZoneRect(drag.startWX, drag.startWY, drag.curWX, drag.curWY, 'New Place');
      } else if (drag.type === 'brush' && drag.brushPts.length > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
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

      // 9. Clean Minimalist Room Pills
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

        ctx.fillStyle = isSelected ? 'rgba(255, 255, 255, 0.94)' : 'rgba(9, 9, 11, 0.62)';
        ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.14)';
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
          ctx.fillStyle = '#ffffff';
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

        ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.font = '500 9.5px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${room.area_m2}m²`, lp.x, lp.y + 19);
        ctx.restore();
      }

      // 10. Target Pin
      const activePin = dPin || robot.target_pin;
      if (activePin) {
        const pp = w2s(activePin.x, activePin.y);
        const pulse = (Math.sin(now * 0.005) + 1) / 2;
        ctx.save();
        ctx.strokeStyle = activePin.spot_clean ? '#fbbf24' : '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 9 + pulse * 12, 0, Math.PI * 2);
        ctx.globalAlpha = 0.65 - pulse * 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = activePin.spot_clean ? '#fbbf24' : '#ffffff';
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 11. Minimal Charging Dock Marker
      const dp = w2s(floorplan.dock.x, floorplan.dock.y);
      ctx.save();
      ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#09090b';
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

      // 12. Live Robot Vacuum Indicator
      const sr = smoothRobotRef.current;
      if (!sr.init) {
        sr.x = robot.x;
        sr.y = robot.y;
        sr.init = true;
      } else {
        sr.x += (robot.x - sr.x) * 0.2;
        sr.y += (robot.y - sr.y) * 0.2;
      }
      const rp = w2s(sr.x, sr.y);
      ctx.save();
      ctx.translate(rp.x, rp.y);
      ctx.fillStyle = '#18181b';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 2.8, 0, Math.PI * 2);
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
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.max(0.3, Math.min(10.0, cam.scale * factor));
    const ratio = newScale / cam.scale;
    cam.offsetX = sx - (sx - cam.offsetX) * ratio;
    cam.offsetY = sy - (sy - cam.offsetY) * ratio;
    cam.scale = newScale;
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
      camRef.current.offsetX = drag.startCamX + (sx - drag.startScreenX);
      camRef.current.offsetY = drag.startCamY + (sy - drag.startScreenY);
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
      setHoveredRoomName(`${hitPlace.name} (Custom Place)`);
      return;
    }
    hoveredPlaceIdRef.current = null;

    const hit = hitTestRoom(w.x, w.y);
    const nextId = hit ? hit.id : null;
    if (hoveredRoomIdRef.current !== nextId) {
      hoveredRoomIdRef.current = nextId;
      setHoveredRoomId(nextId);
      setHoveredRoomName(hit ? hit.name : null);
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
      ? hoveredRoomName
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

      {/* Minimal Translucent Coordinate Chip (Bottom-Left) */}
      <div className="pointer-events-none absolute bottom-5 left-5 flex items-center gap-2">
        {cursorWorld && (
          <div className="rounded-full border border-white/[0.08] bg-zinc-900/45 px-3 py-1 font-mono text-[11px] text-zinc-400 backdrop-blur-2xl">
            {(cursorWorld.x * unitM).toFixed(2)}m, {(cursorWorld.y * unitM).toFixed(2)}m
            {isReal && <span className="ml-2 text-emerald-400">● SLAM</span>}
          </div>
        )}
        {hoveredRoomName && toolMode === 'rooms' && (
          <div className="rounded-full border border-white/[0.1] bg-zinc-900/55 px-3 py-1 text-[11px] text-zinc-200 backdrop-blur-2xl">
            {hoveredRoomName} <span className="text-zinc-500">· double-click to rename</span>
          </div>
        )}
      </div>
    </div>
  );
};
