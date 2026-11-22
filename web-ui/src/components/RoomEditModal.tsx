import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import type { Room } from '../types';

interface RoomEditModalProps {
  room: Room | null;
  onClose: () => void;
  onSave: (roomId: number, patch: { name: string; color: string; suction: string; water: string }) => Promise<void>;
}

const SWATCHES = ['#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#2dd4bf', '#fb7185', '#60a5fa'];

export const RoomEditModal: React.FC<RoomEditModalProps> = ({ room, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#38bdf8');
  const [suction, setSuction] = useState('normal');
  const [water, setWater] = useState('closed');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (room) {
      setName(room.name);
      setColor(room.color);
      setSuction(room.suction || 'normal');
      setWater(room.water || 'closed');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md">
      <form onSubmit={handleSubmit} className="ios-sheet w-full max-w-sm rounded-[26px] p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-[17px] font-semibold text-white">Room #{room.id + 1}</h3>
            <p className="text-[12px] text-[#c7c7cc]">Saved locally on this device</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2c2c2e] text-white hover:bg-[#3a3a3c]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
              Room Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="ios26-input w-full px-4 py-3 text-[15px]"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
              Floorplan Color
            </label>
            <div className="flex flex-wrap gap-2.5">
              {SWATCHES.map((sw) => (
                <button
                  key={sw}
                  type="button"
                  onClick={() => setColor(sw)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                    color === sw ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#1c1c1e]' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: sw }}
                >
                  {color === sw && <Check className="h-4 w-4 text-black" />}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
                Suction
              </label>
              <div className="ios-segmented grid grid-cols-4 gap-1">
                {[
                  { id: 'turnoff', label: 'Off' },
                  { id: 'gentle', label: 'Quiet' },
                  { id: 'normal', label: 'Std' },
                  { id: 'strong', label: 'Max' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSuction(opt.id)}
                    className={`rounded-full py-1.5 text-[12.5px] font-semibold transition ${
                      suction === opt.id ? 'ios-segmented-active' : 'text-[#c7c7cc] hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-[#c7c7cc]">
                Water
              </label>
              <div className="ios-segmented grid grid-cols-4 gap-1">
                {[
                  { id: 'closed', label: 'Dry' },
                  { id: 'low', label: 'Low' },
                  { id: 'middle', label: 'Med' },
                  { id: 'high', label: 'High' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setWater(opt.id)}
                    className={`rounded-full py-1.5 text-[12.5px] font-semibold transition ${
                      water === opt.id ? 'ios-segmented-active' : 'text-[#c7c7cc] hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[#2c2c2e] px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-[#3a3a3c]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-[#0a84ff] px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[#409cff] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};
