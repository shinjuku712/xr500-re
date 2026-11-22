import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import type { Room } from '../types';

interface RoomEditModalProps {
  room: Room | null;
  onClose: () => void;
  onSave: (roomId: number, patch: { name: string; color: string; suction: string; water: string }) => Promise<void>;
}

const SWATCHES = [
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#a78bfa',
  '#f472b6',
  '#2dd4bf',
  '#fb7185',
  '#60a5fa',
];

export const RoomEditModal: React.FC<RoomEditModalProps> = ({ room, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#38bdf8');
  const [suction, setSuction] = useState('normal');
  const [water, setWater] = useState('normal');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (room) {
      setName(room.name);
      setColor(room.color);
      setSuction(room.suction || 'normal');
      setWater(room.water || 'normal');
    }
  }, [room]);

  if (!room) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(room.id, { name, color, suction, water });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-md">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-900/75 p-5 shadow-2xl backdrop-blur-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Customize Room #{room.id + 1}</h3>
            <p className="text-[11px] text-zinc-400">Saved locally to docs/map_config.json</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.08] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-300">Room Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-300">Floorplan Tint</label>
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((sw) => (
                <button
                  key={sw}
                  type="button"
                  onClick={() => setColor(sw)}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                    color === sw ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : 'opacity-75 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: sw }}
                >
                  {color === sw && <Check className="h-3.5 w-3.5 text-zinc-950" />}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-300">Default Suction</label>
              <select
                value={suction}
                onChange={(e) => setSuction(e.target.value)}
                className="w-full rounded-xl border border-white/[0.1] bg-zinc-900 px-2.5 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              >
                <option value="turnoff">Off</option>
                <option value="gentle">Quiet</option>
                <option value="normal">Standard</option>
                <option value="strong">Max</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-300">Default Water</label>
              <select
                value={water}
                onChange={(e) => setWater(e.target.value)}
                className="w-full rounded-xl border border-white/[0.1] bg-zinc-900 px-2.5 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              >
                <option value="closed">Dry</option>
                <option value="low">Low</option>
                <option value="middle">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.1] px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.06]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Room'}
          </button>
        </div>
      </form>
    </div>
  );
};
