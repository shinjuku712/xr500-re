import React, { useState } from 'react';
import { X, Terminal, Send, Cpu, Layers } from 'lucide-react';
import type { DispatchedPacket, RawDpsResponse } from '../types';

interface ProtocolDrawerProps {
  open: boolean;
  onClose: () => void;
  rawDps: RawDpsResponse | null;
  packets: DispatchedPacket[];
  onInjectDp: (dpId: string, value: unknown) => Promise<void>;
}

export const ProtocolDrawer: React.FC<ProtocolDrawerProps> = ({
  open,
  onClose,
  rawDps,
  packets,
  onInjectDp,
}) => {
  const [dpId, setDpId] = useState('14');
  const [dpVal, setDpVal] = useState('80');
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dpId.trim()) return;
    let parsed: unknown = dpVal.trim();
    if (dpVal.trim().toLowerCase() === 'true') parsed = true;
    else if (dpVal.trim().toLowerCase() === 'false') parsed = false;
    else if (dpVal.trim() !== '' && !Number.isNaN(Number(dpVal.trim()))) parsed = Number(dpVal.trim());

    setSending(true);
    try {
      await onInjectDp(dpId.trim(), parsed);
    } finally {
      setSending(false);
    }
  };

  const dps = rawDps?.dps ?? {};
  const schema = rawDps?.schema ?? {};
  const sortedKeys = Object.keys(dps).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-800/90 bg-[#090e1a]/95 shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Protocol Lab & DP Inspector</h2>
            <p className="text-[11px] text-slate-400">
              Profile: {rawDps?.profile ?? 'T3'} · Port 6668 Local Tuya
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Dispatched Binary Packets Log */}
      <div className="border-b border-slate-800/80 px-5 py-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <Layers className="h-3.5 w-3.5 text-cyan-400" />
          Recent Spatial Packets
        </div>
        {packets.length === 0 ? (
          <p className="rounded-lg border border-slate-800/60 bg-slate-900/50 px-3 py-2.5 text-xs text-slate-500">
            Pick rooms, draw a zone, or drop a pin on the map to inspect the generated binary DP payload here.
          </p>
        ) : (
          <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
            {packets.map((pkt) => (
              <div
                key={pkt.id}
                className="rounded-lg border border-cyan-500/20 bg-slate-900/70 p-2.5 font-mono text-[11px]"
              >
                <div className="flex items-center justify-between text-slate-300">
                  <span className="font-semibold text-cyan-300">
                    DP {pkt.dp} · {pkt.label}
                  </span>
                  <span className="text-[10px] text-slate-500">{pkt.timestamp}</span>
                </div>
                <div className="mt-1 truncate text-amber-300">B64: {pkt.base64}</div>
                <div className="mt-0.5 truncate text-slate-400">
                  HEX: {pkt.hex} ({pkt.bytes}B)
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live DP Table */}
      <div className="flex-1 overflow-y-auto px-5 py-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <Cpu className="h-3.5 w-3.5 text-emerald-400" />
          Live Data Points ({sortedKeys.length})
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/60">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-900/60 text-[11px] text-slate-400">
                <th className="px-3 py-2 font-medium">DP</th>
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {sortedKeys.map((k) => {
                const val = dps[k];
                const meta = schema[k];
                const displayVal =
                  typeof val === 'string' && val.length > 22 ? `${val.slice(0, 22)}…` : String(val);
                return (
                  <tr key={k} className="hover:bg-slate-900/50">
                    <td className="px-3 py-2 font-mono font-semibold text-cyan-400">{k}</td>
                    <td className="px-3 py-2 text-slate-300">{meta?.code ?? 'unknown'}</td>
                    <td className="px-3 py-2 font-mono text-slate-200">{displayVal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Arbitrary DP Injector */}
      <form onSubmit={handleSend} className="border-t border-slate-800/80 bg-slate-950/80 p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Direct DP Injector
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={dpId}
            onChange={(e) => setDpId(e.target.value)}
            placeholder="DP"
            className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 font-mono text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
          />
          <input
            type="text"
            value={dpVal}
            onChange={(e) => setDpVal(e.target.value)}
            placeholder="Value (true, 80, AQECAgQ=)"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </button>
        </div>
      </form>
    </div>
  );
};
