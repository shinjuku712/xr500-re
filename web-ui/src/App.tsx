import React, { useEffect, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  Home,
  Volume2,
  MousePointerClick,
  MapPinPlus,
  SquareDashedMousePointer,
  Paintbrush,
  Crosshair,
  ShieldBan,
  Slash,
  Hand,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  SlidersHorizontal,
  ShieldAlert,
  Trash2,
  Grid,
  Route,
  Search,
} from 'lucide-react';
import { api } from './api';
import type {
  CustomPlace,
  DispatchedPacket,
  DraftZone,
  MapState,
  RawDpsResponse,
  RobotStatus,
  Room,
  SavedPreset,
  TargetPin,
  ToolMode,
} from './types';
import { HouseMapCanvas } from './components/HouseMapCanvas';
import { InspectorPanel, type InspectorTab } from './components/InspectorPanel';
import { RoomEditModal } from './components/RoomEditModal';
import { CommandPalette } from './components/CommandPalette';

const PRESETS_KEY = 'xr500_saved_presets_v1';

const BatteryRing: React.FC<{ pct: number; charging: boolean }> = ({ pct, charging }) => {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = 7;
  const circ = 2 * Math.PI * r;
  const offset = circ - (clamped / 100) * circ;
  const stroke = clamped >= 35 ? '#34d399' : clamped >= 18 ? '#fbbf24' : '#f43f5e';
  return (
    <div className="flex items-center gap-1.5">
      <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90">
        <circle cx="9" cy="9" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="font-mono text-[11px] font-medium text-zinc-200">
        {clamped}%{charging ? '⚡' : ''}
      </span>
    </div>
  );
};

export default function App() {
  const [status, setStatus] = useState<RobotStatus | null>(null);
  const [mapState, setMapState] = useState<MapState | null>(null);
  const [rawDps, setRawDps] = useState<RawDpsResponse | null>(null);

  // Picking & Drawing State
  const [toolMode, setToolMode] = useState<ToolMode>('rooms');
  const [selectedRoomIds, setSelectedRoomIds] = useState<number[]>([]);
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([]);
  const [roomPasses, setRoomPasses] = useState<number>(1);
  const [draftZones, setDraftZones] = useState<DraftZone[]>([]);
  const [draftPin, setDraftPin] = useState<TargetPin | null>(null);
  const [spotClean, setSpotClean] = useState<boolean>(true);
  const [brushRadiusPx, setBrushRadiusPx] = useState<number>(12);

  // Custom Place Modal State
  const [newPlaceRect, setNewPlaceRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [editingPlace, setEditingPlace] = useState<CustomPlace | null>(null);
  const [placeNameInput, setPlaceNameInput] = useState('');
  const [placeColorInput, setPlaceColorInput] = useState('#38bdf8');

  // Poop Guard State
  const [poopRadiusPx, setPoopRadiusPx] = useState<number>(10);
  const [preFlightGate, setPreFlightGate] = useState<boolean>(true);
  const [pendingAction, setPendingAction] = useState<{ label: string; run: () => Promise<void> } | null>(null);

  // Saved Quick-Clean Presets
  const [presets, setPresets] = useState<SavedPreset[]>(() => {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // View, Inspector & Palette State
  const [fitTrigger, setFitTrigger] = useState(0);
  const [zoomDelta, setZoomDelta] = useState({ dir: 0, seq: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [showTrajectory, setShowTrajectory] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('clean');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [packets, setPackets] = useState<DispatchedPacket[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const pushToast = useCallback((msg: string) => setToast(msg), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const recordPacket = useCallback(
    (label: string, pkt: { dp: number; base64: string; hex: string; bytes: number }) => {
      const ts = new Date().toLocaleTimeString([], { hour12: false });
      setPackets((prev) => [
        { id: `${Date.now()}-${Math.random()}`, timestamp: ts, label, ...pkt },
        ...prev.slice(0, 19),
      ]);
    },
    []
  );

  const refreshAll = useCallback(async () => {
    try {
      const [st, mp] = await Promise.all([api.getStatus(), api.getMap()]);
      setStatus(st);
      setMapState(mp);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const refreshDps = useCallback(async () => {
    try {
      setRawDps(await api.getRawDps());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshAll();
    refreshDps();
    // Fast 1.2s map poll to mirror HoSLAM 1Hz live stream smoothly
    const mapTimer = setInterval(() => {
      api.getMap().then(setMapState).catch(() => {});
    }, 1200);
    const statusTimer = setInterval(() => {
      api.getStatus().then(setStatus).catch(() => {});
      if (inspectorOpen && inspectorTab === 'lab') refreshDps();
    }, 2500);
    return () => {
      clearInterval(mapTimer);
      clearInterval(statusTimer);
    };
  }, [refreshAll, refreshDps, inspectorOpen, inspectorTab]);

  // Global keyboard shortcuts (including Cmd/Ctrl+K Command Palette)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') setToolMode('rooms');
      else if (e.key.toLowerCase() === 'n') setToolMode('place');
      else if (e.key === '2') setToolMode('zone');
      else if (e.key === '3') setToolMode('brush');
      else if (e.key === '4') setToolMode('pin');
      else if (e.key === '5' || e.key.toLowerCase() === 'p') setToolMode('poop');
      else if (e.key === '6') setToolMode('nogo');
      else if (e.key === '7') setToolMode('vwall');
      else if (e.key === '8' || e.key.toLowerCase() === 'h') setToolMode('pan');
      else if (e.key.toLowerCase() === 'r') setFitTrigger((n) => n + 1);
      else if (e.key === 'Escape') {
        setSelectedRoomIds([]);
        setSelectedPlaceIds([]);
        setDraftZones([]);
        setDraftPin(null);
        setPendingAction(null);
        setNewPlaceRect(null);
        setEditingPlace(null);
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const runWithPoopCheck = (label: string, fn: () => Promise<void>) => {
    if (preFlightGate) {
      setPendingAction({ label, run: fn });
    } else {
      fn();
    }
  };

  const handleToggleRoom = useCallback((roomId: number) => {
    setSelectedRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  }, []);

  const handleTogglePlace = useCallback((placeId: string) => {
    setSelectedPlaceIds((prev) =>
      prev.includes(placeId) ? prev.filter((id) => id !== placeId) : [...prev, placeId]
    );
  }, []);

  const handleAddDraftZone = useCallback((zone: Omit<DraftZone, 'id'>) => {
    setDraftZones((prev) => [...prev, { ...zone, id: `z-${Date.now()}` }]);
  }, []);

  const executeCleanRooms = async (ids: number[], passes: number) => {
    const res = await api.cleanRooms(ids, passes);
    recordPacket(`Rooms [${ids.join(',')}] (${passes}×)`, res.packet);
    pushToast(`Cleaning ${ids.length} room(s) · ${passes}×`);
    refreshAll();
  };

  const executeCleanZones = async (zones: DraftZone[]) => {
    const res = await api.cleanZones(zones);
    recordPacket(`Zones (${zones.length})`, res.packet);
    pushToast(`Dispatched ${zones.length} zone(s)`);
    refreshAll();
  };

  const executeGotoPin = async (pin: TargetPin) => {
    const res = await api.gotoPoint(pin.x, pin.y, spotClean);
    recordPacket(spotClean ? 'Spot Clean' : 'Go-To', res.packet);
    pushToast(spotClean ? 'Spot cleaning target pin' : 'Navigating to pin');
    refreshAll();
  };

  const handleDropPoop = async (x: number, y: number) => {
    const res = await api.addPoopHazard(x, y, poopRadiusPx, 'Pet Hazard');
    if (res.packet) recordPacket('Poop No-Go (0x1A)', res.packet);
    pushToast('💩 Hazard locked & pushed to robot');
    refreshAll();
  };

  const handleSavePreset = (name: string) => {
    const next: SavedPreset =
      draftZones.length > 0
        ? { id: `p-${Date.now()}`, name, kind: 'zones', zones: draftZones, passes: draftZones[0].passes }
        : { id: `p-${Date.now()}`, name, kind: 'rooms', roomIds: selectedRoomIds, passes: roomPasses };
    const updated = [next, ...presets];
    setPresets(updated);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
    pushToast(`Saved preset "${name}"`);
  };

  const handleDeletePreset = (id: string) => {
    const updated = presets.filter((p) => p.id !== id);
    setPresets(updated);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
  };

  const handleEmergencyHalt = useCallback(
    async (reason: string) => {
      await api.sendCommand('pause');
      await api.sendCommand('dock');
      pushToast(`⚠️ ${reason}`);
      refreshAll();
    },
    [pushToast, refreshAll]
  );

  const rooms = mapState?.floorplan.rooms ?? [];
  const customPlaces = mapState?.floorplan.custom_places ?? [];
  const hazards = mapState?.floorplan.poop_hazards ?? [];
  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const placesById = new Map(customPlaces.map((p) => [p.id, p]));
  const selectedArea = selectedRoomIds
    .reduce((sum, id) => sum + (roomsById.get(id)?.area_m2 ?? 0), 0)
    .toFixed(1);

  const battery = status?.battery ?? 0;
  const isCharging = status?.status === 'charging' || status?.status === 'charge_done';

  const getPrimaryAction = () => {
    if (selectedPlaceIds.length > 0) {
      const picked = selectedPlaceIds
        .map((id) => placesById.get(id))
        .filter((p): p is CustomPlace => Boolean(p));
      const label =
        picked.length === 1
          ? `Clean ${picked[0].name} · ${picked[0].area_m2}m²`
          : `Clean ${picked.length} Places`;
      const zones: DraftZone[] = picked.map((p) => ({
        id: p.id,
        x1: p.x1,
        y1: p.y1,
        x2: p.x2,
        y2: p.y2,
        passes: roomPasses,
      }));
      return {
        label,
        onClick: () => runWithPoopCheck(label, () => executeCleanZones(zones)),
      };
    }
    if (selectedRoomIds.length > 0) {
      return {
        label: `Clean ${selectedRoomIds.length} Room${selectedRoomIds.length > 1 ? 's' : ''} · ${selectedArea}m²`,
        onClick: () =>
          runWithPoopCheck(`Clean ${selectedRoomIds.length} selected room(s)`, () =>
            executeCleanRooms(selectedRoomIds, roomPasses)
          ),
      };
    }
    if (draftZones.length > 0) {
      return {
        label: `Clean ${draftZones.length} Zone${draftZones.length > 1 ? 's' : ''}`,
        onClick: () =>
          runWithPoopCheck(`Clean ${draftZones.length} drawn zone(s)`, () => executeCleanZones(draftZones)),
      };
    }
    if (draftPin) {
      return {
        label: spotClean ? 'Spot Clean Pin' : 'Go To Pin',
        onClick: () =>
          runWithPoopCheck(spotClean ? 'Spot clean target pin' : 'Navigate to target pin', () =>
            executeGotoPin(draftPin)
          ),
      };
    }
    return {
      label: 'Full Clean',
      onClick: () =>
        runWithPoopCheck('Start full-house auto clean', async () => {
          await api.sendCommand('start');
          pushToast('Started full-house auto clean');
          refreshAll();
        }),
    };
  };

  const primary = getPrimaryAction();

  const dockTools: { id: ToolMode; label: string; k: string; icon: React.ReactNode; warn?: boolean }[] = [
    { id: 'rooms', label: 'Select', k: '1', icon: <MousePointerClick className="h-3.5 w-3.5" /> },
    { id: 'place', label: '+ Place', k: 'N', icon: <MapPinPlus className="h-3.5 w-3.5" /> },
    { id: 'zone', label: 'Zone', k: '2', icon: <SquareDashedMousePointer className="h-3.5 w-3.5" /> },
    { id: 'brush', label: 'Brush', k: '3', icon: <Paintbrush className="h-3.5 w-3.5" /> },
    { id: 'pin', label: 'Pin', k: '4', icon: <Crosshair className="h-3.5 w-3.5" /> },
    { id: 'poop', label: 'Poop', k: '5', icon: <span className="text-xs leading-none">💩</span>, warn: true },
    { id: 'nogo', label: 'No-Go', k: '6', icon: <ShieldBan className="h-3.5 w-3.5" />, warn: true },
    { id: 'vwall', label: 'Wall', k: '7', icon: <Slash className="h-3.5 w-3.5" />, warn: true },
    { id: 'pan', label: 'Pan', k: '8', icon: <Hand className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#08090c] text-zinc-100">
      {/* FULL-BLEED ARCHITECTURAL SLAM CANVAS */}
      <HouseMapCanvas
        mapState={mapState}
        toolMode={toolMode}
        selectedRoomIds={selectedRoomIds}
        onToggleRoom={handleToggleRoom}
        onEditRoom={setEditingRoom}
        selectedPlaceIds={selectedPlaceIds}
        onTogglePlace={handleTogglePlace}
        onEditPlace={(pl) => {
          setEditingPlace(pl);
          setPlaceNameInput(pl.name);
          setPlaceColorInput(pl.color);
        }}
        onDraftNewPlace={(rect) => {
          setNewPlaceRect(rect);
          setPlaceNameInput('');
          setPlaceColorInput('#38bdf8');
        }}
        draftZones={draftZones}
        onAddDraftZone={handleAddDraftZone}
        draftPin={draftPin}
        spotClean={spotClean}
        onSetDraftPin={setDraftPin}
        onAddNoGo={async (x1, y1, x2, y2) => {
          await api.addNoGoZone(x1, y1, x2, y2);
          const res = await api.pushNoGo();
          if (res.packet) recordPacket('No-Go (0x1A)', res.packet);
          pushToast('No-Go Zone pushed to robot');
          refreshAll();
        }}
        onAddVWall={async (x1, y1, x2, y2) => {
          await api.addVirtualWall(x1, y1, x2, y2);
          pushToast('Virtual Wall saved');
          refreshAll();
        }}
        onDropPoop={handleDropPoop}
        brushRadiusPx={brushRadiusPx}
        fitTrigger={fitTrigger}
        zoomDelta={zoomDelta}
        showGrid={showGrid}
        showTrajectory={showTrajectory}
      />

      {/* TOP STUDIO TELEMETRY BAR */}
      <header className="pointer-events-none fixed inset-x-0 top-4 z-30 flex items-center justify-between gap-3 px-5">
        {/* Left: Hardware Identity + Live Telemetry */}
        <div className="glass-pill pointer-events-auto flex items-center gap-3.5 rounded-full px-4 py-2">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                status?.online && !status?.simulation
                  ? 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.85)]'
                  : 'bg-amber-400'
              }`}
            />
            <span className="text-xs font-semibold tracking-tight text-white">XR500</span>
            <span className="hidden font-mono text-[10.5px] text-zinc-500 sm:inline">
              {status?.ip ?? 'connecting…'}
            </span>
          </div>

          <div className="h-3.5 w-px bg-white/[0.1]" />

          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] capitalize text-zinc-300">
              {(status?.status ?? 'standby').replace('_', ' ')}
            </span>
            <BatteryRing pct={battery} charging={isCharging} />
            <span className="hidden font-mono text-[11px] text-zinc-400 md:inline">
              {status?.clean_area_m2 ?? 0}m² · {status?.clean_time_min ?? 0}m
            </span>
          </div>
        </div>

        {/* Center/Right: Spotlight Search + Controls */}
        <div className="glass-pill pointer-events-auto flex items-center gap-1 rounded-full p-1">
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-full px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100 lg:flex"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Quick Command</span>
            <span className="kbd-cap">⌘K</span>
          </button>

          <button
            onClick={() => {
              setInspectorTab('poop');
              setInspectorOpen(true);
            }}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              hazards.length > 0 || preFlightGate
                ? 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Poop Guard</span>
            {hazards.length > 0 && (
              <span className="rounded-full bg-amber-400 px-1.5 font-mono text-[10px] font-bold text-zinc-950">
                {hazards.length}
              </span>
            )}
          </button>

          <button
            onClick={async () => {
              setSyncing(true);
              try {
                await api.syncMap();
                await refreshAll();
                setFitTrigger((n) => n + 1);
                pushToast('SLAM synced');
              } finally {
                setSyncing(false);
              }
            }}
            title="Sync Map"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.08] hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setShowTrajectory((v) => !v)}
            title="Toggle Path"
            className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
              showTrajectory ? 'bg-white/[0.1] text-sky-300' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <Route className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => setShowGrid((v) => !v)}
            title="Toggle Grid"
            className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
              showGrid ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => {
              setInspectorOpen((v) => !v);
              refreshDps();
            }}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              inspectorOpen
                ? 'bg-white text-zinc-950'
                : 'text-zinc-200 hover:bg-white/[0.08]'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Studio
          </button>
        </div>
      </header>

      {/* FLOATING LEFT ZOOM PILL */}
      <div className="glass-pill fixed left-5 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-full p-1">
        <button
          onClick={() => setZoomDelta((z) => ({ dir: 1, seq: z.seq + 1 }))}
          title="Zoom In"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.08] hover:text-white"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setZoomDelta((z) => ({ dir: -1, seq: z.seq + 1 }))}
          title="Zoom Out"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.08] hover:text-white"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setFitTrigger((n) => n + 1)}
          title="Fit to Screen (R)"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.08] hover:text-white"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* CONTEXTUAL SUB-BAR ABOVE BOTTOM DOCK */}
      {(toolMode === 'brush' ||
        toolMode === 'pin' ||
        toolMode === 'place' ||
        selectedRoomIds.length > 0 ||
        selectedPlaceIds.length > 0 ||
        draftZones.length > 0 ||
        draftPin) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4">
          <div className="glass-pill pointer-events-auto flex items-center gap-3 rounded-full px-4 py-1.5 text-xs">
            {toolMode === 'place' && (
              <span className="text-zinc-300">
                Drag over any area (e.g. <span className="font-semibold text-white">Corridor</span>) to save as a clickable Place
              </span>
            )}
            {toolMode === 'brush' && (
              <div className="flex items-center gap-2">
                <span className="text-zinc-400">Brush</span>
                <input
                  type="range"
                  min={6}
                  max={24}
                  value={brushRadiusPx}
                  onChange={(e) => setBrushRadiusPx(Number(e.target.value))}
                  className="w-24 accent-sky-400"
                />
                <span className="font-mono text-[11px] text-zinc-200">
                  {((brushRadiusPx * 10) / 100).toFixed(1)}m
                </span>
              </div>
            )}
            {toolMode === 'pin' && (
              <label className="flex cursor-pointer items-center gap-1.5 text-zinc-200">
                <input
                  type="checkbox"
                  checked={spotClean}
                  onChange={(e) => setSpotClean(e.target.checked)}
                  className="accent-sky-400"
                />
                Spot Clean Spiral
              </label>
            )}
            {(selectedRoomIds.length > 0 || selectedPlaceIds.length > 0) && (
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400">Passes</span>
                {[1, 2].map((p) => (
                  <button
                    key={p}
                    onClick={() => setRoomPasses(p)}
                    className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold transition ${
                      roomPasses === p ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {p}×
                  </button>
                ))}
              </div>
            )}
            {(selectedRoomIds.length > 0 || selectedPlaceIds.length > 0 || draftZones.length > 0 || draftPin) && (
              <button
                onClick={() => {
                  setSelectedRoomIds([]);
                  setSelectedPlaceIds([]);
                  setDraftZones([]);
                  setDraftPin(null);
                }}
                className="flex items-center gap-1 text-zinc-400 hover:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* FLOATING HARDWARE BOTTOM DOCK */}
      <footer className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
        <div className="glass-pill pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 rounded-full p-1.5">
          <div className="flex items-center gap-0.5">
            {dockTools.map((t) => {
              const active = toolMode === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setToolMode(t.id)}
                  title={`${t.label} (${t.k})`}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-medium transition ${
                    active
                      ? t.warn
                        ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40'
                        : 'bg-white text-zinc-950 shadow-sm'
                      : 'text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100'
                  }`}
                >
                  {t.icon}
                  <span className="hidden md:inline">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="h-5 w-px bg-white/[0.1]" />

          <button
            onClick={primary.onClick}
            className="flex items-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-xs font-semibold text-zinc-950 shadow-[0_0_20px_rgba(56,189,248,0.35)] transition hover:bg-sky-300 active:scale-[0.98]"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {primary.label}
          </button>

          <div className="flex items-center gap-0.5">
            <button
              onClick={async () => {
                await api.sendCommand('pause');
                pushToast('Paused');
                refreshAll();
              }}
              title="Pause"
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            >
              <Pause className="h-4 w-4" />
            </button>
            <button
              onClick={async () => {
                await api.sendCommand('dock');
                pushToast('Returning to dock');
                refreshAll();
              }}
              title="Return to Dock"
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            >
              <Home className="h-4 w-4" />
            </button>
            <button
              onClick={async () => {
                await api.sendCommand('locate');
                pushToast('Locate beep triggered');
              }}
              title="Locate Robot"
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            >
              <Volume2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </footer>

      {/* COLLAPSIBLE STUDIO INSPECTOR */}
      <InspectorPanel
        open={inspectorOpen}
        tab={inspectorTab}
        onTabChange={setInspectorTab}
        onClose={() => setInspectorOpen(false)}
        status={status}
        rooms={rooms}
        selectedRoomIds={selectedRoomIds}
        draftZones={draftZones}
        roomPasses={roomPasses}
        presets={presets}
        onSavePreset={handleSavePreset}
        onRunPreset={(p) =>
          runWithPoopCheck(`Run preset "${p.name}"`, async () => {
            if (p.kind === 'rooms' && p.roomIds) await executeCleanRooms(p.roomIds, p.passes);
            else if (p.kind === 'zones' && p.zones) await executeCleanZones(p.zones);
          })
        }
        onDeletePreset={handleDeletePreset}
        onSuction={async (lvl) => {
          await api.setSuction(lvl);
          pushToast(`Suction: ${lvl}`);
          refreshAll();
        }}
        onWater={async (lvl) => {
          await api.setWater(lvl);
          pushToast(`Water: ${lvl}`);
          refreshAll();
        }}
        onVolume={async (v) => {
          await api.setVolume(v);
          pushToast(`Volume: ${v}%`);
          refreshAll();
        }}
        onToggle={async (feat, val) => {
          await api.setToggle(feat, val);
          pushToast(`${feat}: ${val ? 'ON' : 'OFF'}`);
          refreshAll();
        }}
        onDirection={async (dir) => {
          await api.setDirection(dir);
        }}
        onWallFollow={() =>
          runWithPoopCheck('Start edge wall-follow clean', async () => {
            await api.sendCommand('wallfollow');
            pushToast('Wall-follow clean started');
            refreshAll();
          })
        }
        onResetConsumable={async (part) => {
          await api.resetConsumable(part);
          pushToast(`Reset ${part} counter`);
          refreshAll();
        }}
        hazards={hazards}
        poopRadiusPx={poopRadiusPx}
        onChangePoopRadius={setPoopRadiusPx}
        preFlightGate={preFlightGate}
        onTogglePreFlight={setPreFlightGate}
        onDeleteHazard={async (id) => {
          const res = await api.deletePoopHazard(id);
          if (res.packet) recordPacket('Clear Hazard (0x1A)', res.packet);
          pushToast('Hazard cleared & synced');
          refreshAll();
        }}
        onSelectPoopTool={() => {
          setToolMode('poop');
          pushToast('Click the map to drop a 💩 Poop No-Go bubble');
        }}
        onEmergencyHalt={handleEmergencyHalt}
        rawDps={rawDps}
        packets={packets}
        onInjectDp={async (dp, val) => {
          await api.setRawDp(dp, val);
          pushToast(`Sent DP ${dp} = ${JSON.stringify(val)}`);
          refreshAll();
          refreshDps();
        }}
      />

      {/* SPOTLIGHT COMMAND PALETTE (Cmd/Ctrl+K) */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        rooms={rooms}
        places={customPlaces}
        presets={presets}
        onCommand={(cmd) => {
          if (cmd === 'start' || cmd === 'wallfollow') {
            runWithPoopCheck(cmd === 'start' ? 'Full-house clean' : 'Wall-follow clean', async () => {
              await api.sendCommand(cmd);
              pushToast(cmd === 'start' ? 'Started full clean' : 'Started wall-follow');
              refreshAll();
            });
          } else {
            api.sendCommand(cmd).then(() => {
              pushToast(`Sent: ${cmd}`);
              refreshAll();
            });
          }
        }}
        onCleanPlace={(pl) =>
          runWithPoopCheck(`Clean ${pl.name}`, () =>
            executeCleanZones([
              { id: pl.id, x1: pl.x1, y1: pl.y1, x2: pl.x2, y2: pl.y2, passes: roomPasses },
            ])
          )
        }
        onCleanRoom={(r) =>
          runWithPoopCheck(`Clean ${r.name}`, () => executeCleanRooms([r.id], roomPasses))
        }
        onRunPreset={(p) =>
          runWithPoopCheck(`Run preset "${p.name}"`, async () => {
            if (p.kind === 'rooms' && p.roomIds) await executeCleanRooms(p.roomIds, p.passes);
            else if (p.kind === 'zones' && p.zones) await executeCleanZones(p.zones);
          })
        }
        onSelectPoop={() => {
          setToolMode('poop');
          pushToast('Click map to drop 💩 Poop No-Go bubble');
        }}
      />

      {/* PRE-FLIGHT POOP CHECK SAFETY GATE */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md">
          <div className="glass-panel w-full max-w-sm rounded-2xl p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
              <span className="text-lg">💩</span> Pre-Flight Floor Check
            </div>
            <p className="text-xs leading-relaxed text-zinc-300">
              About to run: <span className="font-semibold text-white">{pendingAction.label}</span>.
              {hazards.length > 0
                ? ` ${hazards.length} active Poop No-Go bubble(s) are locked onto the robot.`
                : ' Quick check — is the floor clear of dog poop?'}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setPendingAction(null);
                  setToolMode('poop');
                  pushToast('Click the map to mark the hazard first');
                }}
                className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
              >
                Drop Poop Pin
              </button>
              <button
                onClick={() => setPendingAction(null)}
                className="rounded-xl px-3 py-2 text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const run = pendingAction.run;
                  setPendingAction(null);
                  await run();
                }}
                className="rounded-xl bg-sky-400 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-sky-300"
              >
                Floor Clear · Go
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MINIMAL TOAST */}
      {toast && (
        <div className="glass-pill pointer-events-none fixed top-18 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs text-zinc-100">
          {toast}
        </div>
      )}

      {/* CREATE / EDIT PERMANENT CUSTOM PLACE MODAL */}
      {(newPlaceRect || editingPlace) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-md">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const finalName = placeNameInput.trim() || 'Corridor';
              if (newPlaceRect) {
                const res = await api.addCustomPlace({
                  name: finalName,
                  color: placeColorInput,
                  ...newPlaceRect,
                });
                setNewPlaceRect(null);
                setToolMode('rooms');
                setSelectedPlaceIds([res.place.id]);
                pushToast(`Saved "${finalName}" on floorplan`);
              } else if (editingPlace) {
                await api.updateCustomPlace(editingPlace.id, {
                  name: finalName,
                  color: placeColorInput,
                });
                setEditingPlace(null);
                pushToast(`Updated "${finalName}"`);
              }
              refreshAll();
            }}
            className="glass-panel w-full max-w-sm rounded-2xl p-5"
          >
            <h3 className="text-sm font-semibold text-white">
              {newPlaceRect ? 'Save New Clickable Place' : `Edit "${editingPlace?.name}"`}
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Spans across any rooms — saved permanently on your house map.
            </p>

            <input
              type="text"
              value={placeNameInput}
              onChange={(e) => setPlaceNameInput(e.target.value)}
              placeholder="e.g. Corridor, Entryway, Under Table"
              autoFocus
              className="mt-3 w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-sky-400/50 focus:outline-none"
            />

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {['Corridor', 'Entryway', 'Kitchen Counter', 'Dining Table', 'Dog Corner'].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setPlaceNameInput(chip)}
                  className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/[0.1] hover:text-white"
                >
                  {chip}
                </button>
              ))}
            </div>

            <div className="mt-3.5 flex gap-2">
              {['#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#e2e8f0'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPlaceColorInput(c)}
                  className={`h-6 w-6 rounded-full transition ${
                    placeColorInput === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between">
              {editingPlace ? (
                <button
                  type="button"
                  onClick={async () => {
                    await api.deleteCustomPlace(editingPlace.id);
                    setSelectedPlaceIds((prev) => prev.filter((id) => id !== editingPlace.id));
                    setEditingPlace(null);
                    pushToast(`Deleted "${editingPlace.name}"`);
                    refreshAll();
                  }}
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                >
                  Delete
                </button>
              ) : (
                <div />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNewPlaceRect(null);
                    setEditingPlace(null);
                  }}
                  className="rounded-xl px-3 py-2 text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-sky-400 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-sky-300"
                >
                  {newPlaceRect ? 'Save Place' : 'Update'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ROOM CUSTOMIZER MODAL */}
      <RoomEditModal
        room={editingRoom}
        onClose={() => setEditingRoom(null)}
        onSave={async (id, patch) => {
          await api.updateRoom(id, patch);
          pushToast(`Renamed to "${patch.name}"`);
          refreshAll();
        }}
      />
    </div>
  );
}
