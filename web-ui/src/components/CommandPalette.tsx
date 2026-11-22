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
  Map as MapIcon,
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
  onQuickMap: () => void;
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
  onQuickMap,
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
        icon: <Play className="h-4 w-4 text-[#0a84ff]" />,
        run: () => onCommand('start'),
      },
      {
        id: 'act-qmap',
        group: 'Mapping',
        label: 'Quick Map House (Silent)',
        hint: 'Explore',
        icon: <MapIcon className="h-4 w-4 text-[#64d2ff]" />,
        run: onQuickMap,
      },
      {
        id: 'act-pause',
        group: 'Mission',
        label: 'Pause Vacuum',
        icon: <Pause className="h-4 w-4 text-[#ff9f0a]" />,
        run: () => onCommand('pause'),
      },
      {
        id: 'act-dock',
        group: 'Mission',
        label: 'Return to Charging Dock',
        icon: <Home className="h-4 w-4 text-[#30d158]" />,
        run: () => onCommand('dock'),
      },
      {
        id: 'act-locate',
        group: 'Mission',
        label: 'Locate Vacuum ("I am here")',
        icon: <Volume2 className="h-4 w-4 text-white" />,
        run: () => onCommand('locate'),
      },
      {
        id: 'act-wall',
        group: 'Mission',
        label: 'Edge / Wall-Follow Clean',
        icon: <Compass className="h-4 w-4 text-white" />,
        run: () => onCommand('wallfollow'),
      },
      {
        id: 'act-poop',
        group: 'Safety',
        label: 'Drop Poop No-Go Pin',
        hint: 'P',
        icon: <ShieldAlert className="h-4 w-4 text-[#ff9f0a]" />,
        run: onSelectPoop,
      },
    ];

    for (const pl of places) {
      list.push({
        id: `pl-${pl.id}`,
        group: 'Custom Places',
        label: `Clean ${pl.name}`,
        hint: `${pl.area_m2}m²`,
        icon: <MapPin className="h-4 w-4 text-[#64d2ff]" />,
        run: () => onCleanPlace(pl),
      });
    }

    for (const r of rooms) {
      list.push({
        id: `rm-${r.id}`,
        group: 'Rooms',
        label: `Clean ${r.name}`,
        hint: `${r.area_m2}m²`,
        icon: <Layers className="h-4 w-4" style={{ color: r.color }} />,
        run: () => onCleanRoom(r),
      });
    }

    for (const p of presets) {
      list.push({
        id: `pr-${p.id}`,
        group: 'Presets',
        label: `Run Preset: ${p.name}`,
        hint: `${p.passes}×`,
        icon: <Bookmark className="h-4 w-4 text-[#30d158]" />,
        run: () => onRunPreset(p),
      });
    }

    return list;
  }, [rooms, places, presets, onCommand, onQuickMap, onCleanPlace, onCleanRoom, onRunPreset, onSelectPoop]);

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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="ios-sheet w-full max-w-md overflow-hidden rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 bg-[#2c2c2e] px-4 py-3.5">
          <Search className="h-4 w-4 text-[#c7c7cc]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Clean corridor, quick map, dock, locate…"
            autoFocus
            className="flex-1 bg-transparent text-[15px] text-white placeholder:text-[#aeaeb2] focus:outline-none"
          />
          <span className="ios-kbd">ESC</span>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-[#c7c7cc]">No matching commands</div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  item.run();
                  onClose();
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-[14px] transition ${
                  i === idx ? 'bg-[#3a3a3c] text-white' : 'text-[#ebebf5] hover:bg-[#2c2c2e]'
                }`}
              >
                <span className="flex items-center gap-3">
                  {item.icon}
                  <span className="font-medium">{item.label}</span>
                  <span className="text-[12px] text-[#aeaeb2]">{item.group}</span>
                </span>
                {item.hint && <span className="font-mono text-[12px] text-[#c7c7cc]">{item.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
