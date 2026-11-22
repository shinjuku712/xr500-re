import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Play,
  Pause,
  Home,
  Volume2,
  Compass,
  MapPin,
  Bookmark,
  Layers,
  ShieldAlert,
} from 'lucide-react';
import type { CustomPlace, Room, SavedPreset } from '../types';

export interface PaletteAction {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  rooms: Room[];
  places: CustomPlace[];
  presets: SavedPreset[];
  onCommand: (cmd: 'start' | 'pause' | 'dock' | 'locate' | 'wallfollow') => void;
  onCleanPlace: (place: CustomPlace) => void;
  onCleanRoom: (room: Room) => void;
  onRunPreset: (preset: SavedPreset) => void;
  onSelectPoop: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  rooms,
  places,
  presets,
  onCommand,
  onCleanPlace,
  onCleanRoom,
  onRunPreset,
  onSelectPoop,
}) => {
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIdx(0);
    }
  }, [open]);

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [
      {
        id: 'act-start',
        group: 'Mission',
        label: 'Start Full-House Clean',
        hint: 'Auto',
        icon: <Play className="h-3.5 w-3.5 text-sky-400" />,
        run: () => onCommand('start'),
      },
      {
        id: 'act-pause',
        group: 'Mission',
        label: 'Pause Vacuum',
        icon: <Pause className="h-3.5 w-3.5 text-amber-300" />,
        run: () => onCommand('pause'),
      },
      {
        id: 'act-dock',
        group: 'Mission',
        label: 'Return to Charging Dock',
        icon: <Home className="h-3.5 w-3.5 text-emerald-400" />,
        run: () => onCommand('dock'),
      },
      {
        id: 'act-locate',
        group: 'Mission',
        label: 'Locate Vacuum ("I am here")',
        icon: <Volume2 className="h-3.5 w-3.5 text-zinc-300" />,
        run: () => onCommand('locate'),
      },
      {
        id: 'act-wall',
        group: 'Mission',
        label: 'Edge / Wall-Follow Clean',
        icon: <Compass className="h-3.5 w-3.5 text-zinc-300" />,
        run: () => onCommand('wallfollow'),
      },
      {
        id: 'act-poop',
        group: 'Safety',
        label: 'Drop Poop No-Go Pin',
        hint: 'P',
        icon: <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />,
        run: onSelectPoop,
      },
    ];

    for (const pl of places) {
      list.push({
        id: `pl-${pl.id}`,
        group: 'Custom Places',
        label: `Clean ${pl.name}`,
        hint: `${pl.area_m2}m²`,
        icon: <MapPin className="h-3.5 w-3.5 text-sky-300" />,
        run: () => onCleanPlace(pl),
      });
    }

    for (const r of rooms) {
      list.push({
        id: `rm-${r.id}`,
        group: 'Rooms',
        label: `Clean ${r.name}`,
        hint: `${r.area_m2}m²`,
        icon: <Layers className="h-3.5 w-3.5" style={{ color: r.color }} />,
        run: () => onCleanRoom(r),
      });
    }

    for (const p of presets) {
      list.push({
        id: `pr-${p.id}`,
        group: 'Presets',
        label: `Run Preset: ${p.name}`,
        hint: `${p.passes}×`,
        icon: <Bookmark className="h-3.5 w-3.5 text-emerald-300" />,
        run: () => onRunPreset(p),
      });
    }

    return list;
  }, [rooms, places, presets, onCommand, onCleanPlace, onCleanRoom, onRunPreset, onSelectPoop]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) => a.label.toLowerCase().includes(q) || a.group.toLowerCase().includes(q)
    );
  }, [actions, query]);

  useEffect(() => {
    setIdx(0);
  }, [query]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && filtered[idx]) {
      e.preventDefault();
      filtered[idx].run();
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-[14vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-md overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.08] px-4 py-3">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Clean corridor, dock, locate, room…"
            autoFocus
            className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-500 focus:outline-none"
          />
          <span className="kbd-cap">ESC</span>
        </div>

        <div className="max-h-72 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">No matching commands</div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  item.run();
                  onClose();
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition ${
                  i === idx ? 'bg-white/[0.1] text-white' : 'text-zinc-300 hover:bg-white/[0.05]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon}
                  <span className="font-medium">{item.label}</span>
                  <span className="text-[10px] text-zinc-500">{item.group}</span>
                </span>
                {item.hint && <span className="font-mono text-[10px] text-zinc-400">{item.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
