import React, { useState } from 'react';
import {
  Sliders,
  Wrench,
  ShieldAlert,
  Terminal,
  X,
  Wind,
  Droplets,
  Volume2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Square,
  Bookmark,
  Play,
  Trash2,
  RotateCcw,
  Send,
  Compass,
  Map as MapIcon,
  LayoutGrid,
} from 'lucide-react';
import type {
  DispatchedPacket,
  DraftZone,
  PoopHazard,
  RawDpsResponse,
  RobotStatus,
  Room,
  SavedPreset,
} from '../types';
import { PoopGuardPanel } from './PoopGuardPanel';

export type InspectorTab = 'clean' | 'care' | 'poop' | 'lab';

interface InspectorPanelProps {
  open: boolean;
  tab: InspectorTab;
  onTabChange: (t: InspectorTab) => void;
  onClose: () => void;
  status: RobotStatus | null;
  rooms: Room[];
  selectedRoomIds: number[];
  draftZones: DraftZone[];
  roomPasses: number;
  presets: SavedPreset[];
  onSavePreset: (name: string) => void;
  onRunPreset: (preset: SavedPreset) => void;
  onDeletePreset: (id: string) => void;
  onSuction: (lvl: string) => void;
  onWater: (lvl: string) => void;
  onVolume: (v: number) => void;
  onToggle: (feature: 'dnd' | 'break_clean' | 'y_mop' | 'custom_mode', val: boolean) => void;
  onDirection: (dir: 'foward' | 'backward' | 'turn_left' | 'turn_right' | 'stop') => void;
  onWallFollow: () => void;
  onQuickMap: () => void;
  onSegmentRooms: () => void;
  onResetMap: () => void;
  onResetConsumable: (part: 'edge_brush' | 'roll_brush' | 'filter' | 'duster_cloth') => void;
  hazards: PoopHazard[];
  poopRadiusPx: number;
  onChangePoopRadius: (px: number) => void;
  preFlightGate: boolean;
  onTogglePreFlight: (v: boolean) => void;
  onDeleteHazard: (id: string) => Promise<void>;
  onSelectPoopTool: () => void;
  onEmergencyHalt: (reason: string) => Promise<void>;
  rawDps: RawDpsResponse | null;
  packets: DispatchedPacket[];
  onInjectDp: (dp: string, val: unknown) => Promise<void>;
}

const SUCTION_OPTS = [
  { id: 'turnoff', label: 'Off' },
  { id: 'gentle', label: 'Quiet' },
  { id: 'normal', label: 'Std' },
  { id: 'strong', label: 'Max' },
];

const WATER_OPTS = [
  { id: 'closed', label: 'Dry' },
  { id: 'low', label: 'Low' },
  { id: 'middle', label: 'Med' },
  { id: 'high', label: 'High' },
];

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  open,
  tab,
  onTabChange,
  onClose,
  status,
  selectedRoomIds,
  draftZones,
  presets,
  onSavePreset,
  onRunPreset,
  onDeletePreset,
  onSuction,
  onWater,
  onVolume,
  onToggle,
  onDirection,
  onWallFollow,
  onQuickMap,
  onSegmentRooms,
  onResetMap,
  onResetConsumable,
  hazards,
  poopRadiusPx,
  onChangePoopRadius,
  preFlightGate,
  onTogglePreFlight,
  onDeleteHazard,
  onSelectPoopTool,
  onEmergencyHalt,
  rawDps,
  packets,
  onInjectDp,
}) => {
  const [presetName, setPresetName] = useState('');
  const [dpId, setDpId] = useState('16');
  const [dpVal, setDpVal] = useState('get_both');
  const [localVol, setLocalVol] = useState<number | null>(null);
  const [kbDrive, setKbDrive] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  React.useEffect(() => {
    if (!kbDrive || !open || tab !== 'clean') return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') { e.preventDefault(); onDirection('foward'); }
      else if (k === 's' || e.key === 'ArrowDown') { e.preventDefault(); onDirection('backward'); }
      else if (k === 'a' || e.key === 'ArrowLeft') { e.preventDefault(); onDirection('turn_left'); }
      else if (k === 'd' || e.key === 'ArrowRight') { e.preventDefault(); onDirection('turn_right'); }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        onDirection('stop');
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [kbDrive, open, tab, onDirection]);

  if (!open) return null;

  const canSavePreset = selectedRoomIds.length > 0 || draftZones.length > 0;
  const volDisplay = localVol ?? status?.volume ?? 80;

  const tabs: { id: InspectorTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'clean', label: 'Control', icon: <Sliders className="h-3.5 w-3.5" /> },
    { id: 'care', label: 'Care', icon: <Wrench className="h-3.5 w-3.5" /> },
    {
      id: 'poop',
      label: 'Poop',
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
      badge: hazards.length || undefined,
    },
    { id: 'lab', label: 'Lab', icon: <Terminal className="h-3.5 w-3.5" /> },
  ];

  const consumables = status?.consumables;
  const consumableRows: {
    key: 'edge_brush' | 'roll_brush' | 'filter' | 'duster_cloth';
    label: string;
    rem: number;
    max: number;
  }[] = [
    { key: 'edge_brush', label: 'Side Brush', rem: consumables?.edge_brush.remaining ?? 0, max: 200 },
    { key: 'roll_brush', label: 'Main Roller Brush', rem: consumables?.roll_brush.remaining ?? 0, max: 300 },
    { key: 'filter', label: 'HEPA Filter', rem: consumables?.filter.remaining ?? 0, max: 120 },
    { key: 'duster_cloth', label: 'Mop Cloth', rem: consumables?.duster_cloth.remaining ?? 0, max: 120 },
  ];

  const dps = rawDps?.dps ?? {};
  const schema = rawDps?.schema ?? {};
  const sortedDpKeys = Object.keys(dps).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

  return (
    <aside className="ios-sheet fixed right-4 top-20 bottom-24 z-30 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[26px]">
      {/* iOS Segmented Tab Bar — Zero Borders */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <div className="ios-segmented flex flex-1 gap-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-[9px] py-2 text-[13px] font-medium transition ${
                tab === t.id ? 'bg-[#48484a] text-white shadow-sm' : 'text-[#c7c7cc] hover:text-white'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.badge !== undefined && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff9f0a] px-1 font-mono text-[10px] font-bold text-black">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2c2c2e] text-[#ebebf5] transition hover:bg-[#3a3a3c]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 space-y-5 overflow-y-auto px-4 pt-2 pb-5">
        {tab === 'clean' && (
          <>
            {/* Quick-Clean Presets */}
            <section className="space-y-2">
              <h3 className="px-1 text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
                Quick-Clean Presets
              </h3>

              {canSavePreset && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!presetName.trim()) return;
                    onSavePreset(presetName.trim());
                    setPresetName('');
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="Save selection (e.g. Under Table)"
                    className="flex-1 rounded-xl bg-[#2c2c2e] px-3.5 py-2.5 text-[13px] text-white placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-[#0a84ff]"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-[#0a84ff] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#409cff]"
                  >
                    Save
                  </button>
                </form>
              )}

              {presets.length === 0 ? (
                <div className="ios-group px-4 py-3 text-[13px] leading-relaxed text-[#c7c7cc]">
                  Pick rooms or draw a zone on the map, then save it here for one-tap cleaning.
                </div>
              ) : (
                <div className="ios-group divide-y divide-white/[0.06] overflow-hidden">
                  {presets.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-4 py-3">
                      <button
                        onClick={() => onRunPreset(p)}
                        className="flex flex-1 items-center gap-2.5 text-left text-[14px] font-medium text-white hover:text-[#64d2ff]"
                      >
                        <Bookmark className="h-4 w-4 text-[#0a84ff]" />
                        <span>{p.name}</span>
                        <span className="font-mono text-[12px] text-[#c7c7cc]">
                          {p.kind === 'rooms' ? `${p.roomIds?.length}R` : `${p.zones?.length}Z`} · {p.passes}×
                        </span>
                      </button>
                      <button
                        onClick={() => onDeletePreset(p.id)}
                        aria-label="Delete preset"
                        className="rounded-full p-1.5 text-[#c7c7cc] hover:bg-[#3a3a3c] hover:text-[#ff453a]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Suction & Water Segmented Controls */}
            <section className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1 text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
                  <Wind className="h-3.5 w-3.5 text-[#64d2ff]" /> Suction Power
                </div>
                <div className="ios-segmented grid grid-cols-4 gap-1">
                  {SUCTION_OPTS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onSuction(s.id)}
                      className={`rounded-[9px] py-2 text-[13px] font-semibold transition ${
                        status?.suction === s.id
                          ? 'bg-[#48484a] text-white shadow-sm'
                          : 'text-[#c7c7cc] hover:text-white'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1 text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
                  <Droplets className="h-3.5 w-3.5 text-[#0a84ff]" /> Mop Water Flow
                </div>
                <div className="ios-segmented grid grid-cols-4 gap-1">
                  {WATER_OPTS.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => onWater(w.id)}
                      className={`rounded-[9px] py-2 text-[13px] font-semibold transition ${
                        status?.water_level === w.id
                          ? 'bg-[#48484a] text-white shadow-sm'
                          : 'text-[#c7c7cc] hover:text-white'
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={onWallFollow}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2c2c2e] py-3 text-[14px] font-medium text-white transition hover:bg-[#3a3a3c]"
              >
                <Compass className="h-4 w-4 text-[#64d2ff]" /> Edge / Baseboard Clean
              </button>
            </section>

            {/* iOS Grouped Settings Toggles */}
            <section className="space-y-2">
              <h3 className="px-1 text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
                Settings
              </h3>
              <div className="ios-group divide-y divide-white/[0.06] overflow-hidden">
                {[
                  { key: 'y_mop' as const, label: 'Y-Pattern Deep Mop', val: Boolean(status?.y_mop) },
                  { key: 'break_clean' as const, label: 'Resume After Recharge', val: Boolean(status?.break_clean) },
                  { key: 'dnd' as const, label: 'Do Not Disturb', val: Boolean(status?.dnd) },
                  { key: 'custom_mode' as const, label: 'Per-Room Custom Mode', val: Boolean(status?.custom_mode) },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between px-4 py-3">
                    <span className="text-[14px] font-medium text-white">{item.label}</span>
                    <button
                      role="switch"
                      aria-checked={item.val}
                      onClick={() => onToggle(item.key, !item.val)}
                      className={`relative h-[28px] w-[48px] rounded-full transition-colors ${
                        item.val ? 'bg-[#30d158]' : 'bg-[#48484a]'
                      }`}
                    >
                      <span
                        className={`absolute top-[2px] h-[24px] w-[24px] rounded-full bg-white shadow transition-all ${
                          item.val ? 'left-[22px]' : 'left-[2px]'
                        }`}
                      />
                    </button>
                  </div>
                ))}

                <div className="flex items-center gap-3 px-4 py-3">
                  <Volume2 className="h-4 w-4 text-[#c7c7cc]" />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volDisplay}
                    onChange={(e) => setLocalVol(Number(e.target.value))}
                    onMouseUp={() => {
                      if (localVol !== null) {
                        onVolume(localVol);
                        setLocalVol(null);
                      }
                    }}
                    className="flex-1 accent-[#0a84ff]"
                  />
                  <span className="w-10 text-right font-mono text-[13px] font-medium text-white">
                    {volDisplay}%
                  </span>
                </div>
              </div>
            </section>

            {/* Manual RC Drive */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
                  Manual RC Drive
                </h3>
                <button
                  onClick={() => setKbDrive((v) => !v)}
                  className={`rounded-full px-3 py-1 font-mono text-[11px] font-semibold transition ${
                    kbDrive ? 'bg-[#0a84ff] text-white' : 'bg-[#2c2c2e] text-[#c7c7cc] hover:text-white'
                  }`}
                >
                  {kbDrive ? 'WASD Active' : 'Enable WASD'}
                </button>
              </div>
              <div className="ios-group p-4">
                <div className="mx-auto grid w-44 grid-cols-3 gap-2">
                  <div />
                  <button
                    onMouseDown={() => onDirection('foward')}
                    onMouseUp={() => onDirection('stop')}
                    className="flex h-12 items-center justify-center rounded-2xl bg-[#3a3a3c] text-white active:bg-[#0a84ff]"
                  >
                    <ArrowUp className="h-5 w-5" />
                  </button>
                  <div />
                  <button
                    onMouseDown={() => onDirection('turn_left')}
                    onMouseUp={() => onDirection('stop')}
                    className="flex h-12 items-center justify-center rounded-2xl bg-[#3a3a3c] text-white active:bg-[#0a84ff]"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => onDirection('stop')}
                    className="flex h-12 items-center justify-center rounded-2xl bg-[#ff453a]/25 text-[#ff6961] hover:bg-[#ff453a]/35"
                  >
                    <Square className="h-4 w-4 fill-current" />
                  </button>
                  <button
                    onMouseDown={() => onDirection('turn_right')}
                    onMouseUp={() => onDirection('stop')}
                    className="flex h-12 items-center justify-center rounded-2xl bg-[#3a3a3c] text-white active:bg-[#0a84ff]"
                  >
                    <ArrowRight className="h-5 w-5" />
                  </button>
                  <div />
                  <button
                    onMouseDown={() => onDirection('backward')}
                    onMouseUp={() => onDirection('stop')}
                    className="flex h-12 items-center justify-center rounded-2xl bg-[#3a3a3c] text-white active:bg-[#0a84ff]"
                  >
                    <ArrowDown className="h-5 w-5" />
                  </button>
                  <div />
                </div>
              </div>
            </section>
          </>
        )}

        {tab === 'care' && (
          <div className="space-y-5">
            {/* Map Setup & First-Time Mapping Controls */}
            <section className="space-y-2">
              <h3 className="px-1 text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
                Floorplan & Mapping
              </h3>
              <div className="ios-group space-y-2 p-3">
                <button
                  onClick={onQuickMap}
                  className="flex w-full items-center justify-between rounded-xl bg-[#0a84ff] px-4 py-3 text-left text-[14px] font-semibold text-white transition hover:bg-[#409cff]"
                >
                  <span className="flex items-center gap-2.5">
                    <MapIcon className="h-4 w-4" />
                    Quick Map House
                  </span>
                  <span className="text-[12px] font-normal text-white/85">Silent</span>
                </button>
                <button
                  onClick={onSegmentRooms}
                  className="flex w-full items-center gap-2.5 rounded-xl bg-[#3a3a3c] px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-[#48484a]"
                >
                  <LayoutGrid className="h-4 w-4 text-[#64d2ff]" />
                  Auto-Segment & Save Rooms
                </button>
                {!confirmReset ? (
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff453a]/15 py-2.5 text-[13px] font-medium text-[#ff6961] transition hover:bg-[#ff453a]/25"
                  >
                    Reset Saved Map
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setConfirmReset(false);
                        onResetMap();
                      }}
                      className="flex-1 rounded-xl bg-[#ff453a] py-2.5 text-[13px] font-semibold text-white"
                    >
                      Confirm Wipe
                    </button>
                    <button
                      onClick={() => setConfirmReset(false)}
                      className="flex-1 rounded-xl bg-[#3a3a3c] py-2.5 text-[13px] font-medium text-white"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Consumables */}
            <section className="space-y-2">
              <h3 className="px-1 text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
                Consumables
              </h3>
              <div className="ios-group divide-y divide-white/[0.06] overflow-hidden">
                {consumableRows.map((c) => {
                  const pct = Math.max(0, Math.min(100, Math.round((c.rem / c.max) * 100)));
                  const barColor =
                    pct > 40 ? 'bg-[#30d158]' : pct > 15 ? 'bg-[#ff9f0a]' : 'bg-[#ff453a]';
                  return (
                    <div key={c.key} className="space-y-2 px-4 py-3.5">
                      <div className="flex items-center justify-between text-[14px]">
                        <span className="font-medium text-white">{c.label}</span>
                        <span className="font-mono text-[13px] text-[#c7c7cc]">
                          {c.rem}h / {c.max}h
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#48484a]">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={() => onResetConsumable(c.key)}
                          className="flex items-center gap-1 text-[12px] font-medium text-[#64d2ff] hover:text-white"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Reset Counter
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {tab === 'poop' && (
          <PoopGuardPanel
            hazards={hazards}
            poopRadiusPx={poopRadiusPx}
            onChangeRadius={onChangePoopRadius}
            preFlightGate={preFlightGate}
            onTogglePreFlight={onTogglePreFlight}
            onDeleteHazard={onDeleteHazard}
            onSelectPoopTool={onSelectPoopTool}
            onEmergencyHalt={onEmergencyHalt}
          />
        )}

        {tab === 'lab' && (
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="px-1 text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
                Dispatched Frames ({packets.length})
              </h3>
              {packets.length === 0 ? (
                <div className="ios-group px-4 py-3 text-[13px] text-[#c7c7cc]">
                  Dispatch rooms, zones, pins, or poop bubbles to inspect DP 15 binary frames.
                </div>
              ) : (
                <div className="max-h-40 space-y-2 overflow-y-auto">
                  {packets.map((pkt) => (
                    <div key={pkt.id} className="ios-group p-3 font-mono text-[11px]">
                      <div className="flex justify-between text-white">
                        <span>DP {pkt.dp} · {pkt.label}</span>
                        <span className="text-[#c7c7cc]">{pkt.timestamp}</span>
                      </div>
                      <div className="mt-1 truncate text-[#ffd60a]">{pkt.base64}</div>
                      <div className="truncate text-[#c7c7cc]">{pkt.hex}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                let parsed: unknown = dpVal.trim();
                if (dpVal.trim().toLowerCase() === 'true') parsed = true;
                else if (dpVal.trim().toLowerCase() === 'false') parsed = false;
                else if (dpVal.trim() !== '' && !Number.isNaN(Number(dpVal.trim()))) parsed = Number(dpVal.trim());
                onInjectDp(dpId.trim(), parsed);
              }}
              className="flex gap-2"
            >
              <input
                value={dpId}
                onChange={(e) => setDpId(e.target.value)}
                className="w-16 rounded-xl bg-[#2c2c2e] px-3 py-2.5 font-mono text-[13px] text-white focus:outline-none focus:ring-2 focus:ring-[#0a84ff]"
              />
              <input
                value={dpVal}
                onChange={(e) => setDpVal(e.target.value)}
                className="flex-1 rounded-xl bg-[#2c2c2e] px-3 py-2.5 font-mono text-[13px] text-white focus:outline-none focus:ring-2 focus:ring-[#0a84ff]"
              />
              <button
                type="submit"
                className="flex items-center justify-center rounded-xl bg-[#0a84ff] px-3.5 text-white hover:bg-[#409cff]"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>

            <div className="ios-group overflow-hidden">
              <table className="w-full text-left text-[12px]">
                <tbody className="divide-y divide-white/[0.06]">
                  {sortedDpKeys.map((k) => (
                    <tr key={k}>
                      <td className="px-3.5 py-2 font-mono font-semibold text-[#64d2ff]">{k}</td>
                      <td className="px-2 py-2 text-[#c7c7cc]">{schema[k]?.code ?? '-'}</td>
                      <td className="max-w-[120px] truncate px-3.5 py-2 font-mono text-white">
                        {String(dps[k])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
