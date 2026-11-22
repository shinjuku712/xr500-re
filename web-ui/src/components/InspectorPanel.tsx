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
    <aside className="fixed right-4 top-20 bottom-24 z-30 flex w-[336px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-950/50 shadow-2xl backdrop-blur-2xl">
      {/* Frosted Tab Strip */}
      <div className="flex items-center justify-between border-b border-white/[0.07] px-2.5 py-2">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`relative flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition ${
                tab === t.id
                  ? 'bg-white/[0.12] text-white'
                  : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'
              }`}
            >
              {t.icon}
              {t.label}
              {t.badge !== undefined && (
                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[10px] font-bold text-zinc-950">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/[0.08] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {tab === 'clean' && (
          <>
            {/* Quick-Clean Saved Presets */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Bookmark className="h-3.5 w-3.5" /> Quick-Clean Presets
                </span>
              </div>

              {canSavePreset && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!presetName.trim()) return;
                    onSavePreset(presetName.trim());
                    setPresetName('');
                  }}
                  className="flex gap-1.5"
                >
                  <input
                    type="text"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="Name current selection (e.g. Under Table)"
                    className="flex-1 rounded-xl border border-white/[0.09] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:border-white/25 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-zinc-200"
                  >
                    Save
                  </button>
                </form>
              )}

              {presets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] px-3 py-2.5 text-[11px] text-zinc-500">
                  Pick rooms or paint/draw a zone on your map, then save it here for 1-click cleaning.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {presets.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2"
                    >
                      <button
                        onClick={() => onRunPreset(p)}
                        className="flex flex-1 items-center gap-2 text-left text-xs font-medium text-zinc-100 hover:text-white"
                      >
                        <Play className="h-3 w-3 text-emerald-400 fill-current" />
                        <span>{p.name}</span>
                        <span className="font-mono text-[10px] text-zinc-500">
                          {p.kind === 'rooms' ? `${p.roomIds?.length}R` : `${p.zones?.length}Z`} · {p.passes}×
                        </span>
                      </button>
                      <button
                        onClick={() => onDeletePreset(p.id)}
                        className="text-zinc-500 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Suction & Water Segmented Controls */}
            <div className="space-y-3 border-t border-white/[0.07] pt-4">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                  <Wind className="h-3.5 w-3.5" /> Suction Power
                </div>
                <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
                  {SUCTION_OPTS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onSuction(s.id)}
                      className={`rounded-lg py-1.5 text-xs font-medium transition ${
                        status?.suction === s.id
                          ? 'bg-white text-zinc-950 shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-100'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                  <Droplets className="h-3.5 w-3.5" /> Mop Water Flow
                </div>
                <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
                  {WATER_OPTS.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => onWater(w.id)}
                      className={`rounded-lg py-1.5 text-xs font-medium transition ${
                        status?.water_level === w.id
                          ? 'bg-white text-zinc-950 shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-100'
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Edge / Wall-Follow Clean */}
              <button
                onClick={onWallFollow}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.04] py-2 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.09]"
              >
                <Compass className="h-3.5 w-3.5" /> Edge / Baseboard Wall-Follow Clean
              </button>
            </div>

            {/* Hardware Feature Toggles & Volume */}
            <div className="space-y-2 border-t border-white/[0.07] pt-4">
              {[
                { key: 'y_mop' as const, label: 'Y-Pattern Deep Mop', val: Boolean(status?.y_mop) },
                { key: 'break_clean' as const, label: 'Resume After Recharge', val: Boolean(status?.break_clean) },
                { key: 'dnd' as const, label: 'Do Not Disturb', val: Boolean(status?.dnd) },
                { key: 'custom_mode' as const, label: 'Per-Room Custom Mode', val: Boolean(status?.custom_mode) },
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <span className="text-xs text-zinc-200">{item.label}</span>
                  <button
                    onClick={() => onToggle(item.key, !item.val)}
                    className={`relative h-5 w-9 rounded-full transition ${
                      item.val ? 'bg-white' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                        item.val ? 'left-4.5 bg-zinc-950' : 'left-0.5 bg-zinc-300'
                      }`}
                    />
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <Volume2 className="h-3.5 w-3.5 text-zinc-400" />
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
                  className="flex-1 accent-white"
                />
                <span className="w-8 text-right font-mono text-[11px] text-zinc-300">{volDisplay}%</span>
              </div>
            </div>

            {/* Live Manual RC D-Pad (DP 12) */}
            <div className="border-t border-white/[0.07] pt-4">
              <div className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Manual RC Drive (DP 12)
              </div>
              <div className="mx-auto grid w-36 grid-cols-3 gap-1.5">
                <div />
                <button
                  onMouseDown={() => onDirection('foward')}
                  onMouseUp={() => onDirection('stop')}
                  className="flex h-10 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.05] text-zinc-200 active:bg-white active:text-zinc-950"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <div />
                <button
                  onMouseDown={() => onDirection('turn_left')}
                  onMouseUp={() => onDirection('stop')}
                  className="flex h-10 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.05] text-zinc-200 active:bg-white active:text-zinc-950"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onDirection('stop')}
                  className="flex h-10 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
                <button
                  onMouseDown={() => onDirection('turn_right')}
                  onMouseUp={() => onDirection('stop')}
                  className="flex h-10 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.05] text-zinc-200 active:bg-white active:text-zinc-950"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
                <div />
                <button
                  onMouseDown={() => onDirection('backward')}
                  onMouseUp={() => onDirection('stop')}
                  className="flex h-10 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.05] text-zinc-200 active:bg-white active:text-zinc-950"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <div />
              </div>
            </div>
          </>
        )}

        {tab === 'care' && (
          <div className="space-y-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Live Consumable Health
            </div>
            {consumableRows.map((c) => {
              const pct = Math.max(0, Math.min(100, Math.round((c.rem / c.max) * 100)));
              const barColor = pct > 40 ? 'bg-emerald-400' : pct > 15 ? 'bg-amber-400' : 'bg-rose-400';
              return (
                <div
                  key={c.key}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-200">{c.label}</span>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {c.rem}h / {c.max}h ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => onResetConsumable(c.key)}
                      className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white"
                    >
                      <RotateCcw className="h-3 w-3" /> Reset Counter
                    </button>
                  </div>
                </div>
              );
            })}
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
            {/* Recent Dispatched Binary Packets */}
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Dispatched Frames ({packets.length})
              </div>
              {packets.length === 0 ? (
                <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] text-zinc-500">
                  Dispatch rooms, zones, pins, or poop bubbles to inspect the exact DP 15 binary frames.
                </p>
              ) : (
                <div className="max-h-36 space-y-1.5 overflow-y-auto">
                  {packets.map((pkt) => (
                    <div
                      key={pkt.id}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 font-mono text-[10px]"
                    >
                      <div className="flex justify-between text-zinc-200">
                        <span>DP {pkt.dp} · {pkt.label}</span>
                        <span className="text-zinc-500">{pkt.timestamp}</span>
                      </div>
                      <div className="mt-0.5 truncate text-amber-300">{pkt.base64}</div>
                      <div className="truncate text-zinc-500">{pkt.hex}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Direct DP Injector */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                let parsed: unknown = dpVal.trim();
                if (dpVal.trim().toLowerCase() === 'true') parsed = true;
                else if (dpVal.trim().toLowerCase() === 'false') parsed = false;
                else if (dpVal.trim() !== '' && !Number.isNaN(Number(dpVal.trim()))) parsed = Number(dpVal.trim());
                onInjectDp(dpId.trim(), parsed);
              }}
              className="flex gap-1.5"
            >
              <input
                value={dpId}
                onChange={(e) => setDpId(e.target.value)}
                className="w-16 rounded-xl border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none"
              />
              <input
                value={dpVal}
                onChange={(e) => setDpVal(e.target.value)}
                className="flex-1 rounded-xl border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none"
              />
              <button
                type="submit"
                className="flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-zinc-950"
              >
                <Send className="h-3 w-3" />
              </button>
            </form>

            {/* Live DPs Table */}
            <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]">
              <table className="w-full text-left text-[11px]">
                <tbody className="divide-y divide-white/[0.05]">
                  {sortedDpKeys.map((k) => (
                    <tr key={k} className="hover:bg-white/[0.03]">
                      <td className="px-2.5 py-1.5 font-mono font-semibold text-zinc-300">{k}</td>
                      <td className="px-2.5 py-1.5 text-zinc-500">{schema[k]?.code ?? '-'}</td>
                      <td className="px-2.5 py-1.5 font-mono text-zinc-200 truncate max-w-[110px]">
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
