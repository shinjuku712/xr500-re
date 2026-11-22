import type { DraftZone, MapState, RawDpsResponse, RobotStatus, Room } from './types';

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export type PacketSummary = { dp: number; base64: string; hex: string; bytes: number };

export const api = {
  getStatus: () => req<RobotStatus>('/api/status'),
  getMap: () => req<MapState>('/api/map'),
  getRawDps: () => req<RawDpsResponse>('/api/dps/raw'),

  sendCommand: (action: 'start' | 'pause' | 'dock' | 'locate' | 'wallfollow') =>
    req<{ status: string; action: string; success: boolean }>(`/api/command/${action}`, {
      method: 'POST',
    }),

  setSuction: (level: string) =>
    req<{ status: string; suction: string }>('/api/suction', {
      method: 'POST',
      body: JSON.stringify({ level }),
    }),

  setWater: (level: string) =>
    req<{ status: string; water_level: string }>('/api/water', {
      method: 'POST',
      body: JSON.stringify({ level }),
    }),

  setDirection: (direction: 'foward' | 'backward' | 'turn_left' | 'turn_right' | 'stop') =>
    req<{ status: string; direction: string }>('/api/direction', {
      method: 'POST',
      body: JSON.stringify({ direction }),
    }),

  setVolume: (volume: number) =>
    req<{ status: string; volume: number }>('/api/volume', {
      method: 'POST',
      body: JSON.stringify({ volume }),
    }),

  setToggle: (feature: 'dnd' | 'break_clean' | 'y_mop' | 'custom_mode', enabled: boolean) =>
    req<{ status: string; feature: string; enabled: boolean }>('/api/toggle', {
      method: 'POST',
      body: JSON.stringify({ feature, enabled }),
    }),

  resetConsumable: (part: 'edge_brush' | 'roll_brush' | 'filter' | 'duster_cloth') =>
    req<{ status: string; part: string }>('/api/consumable/reset', {
      method: 'POST',
      body: JSON.stringify({ part }),
    }),

  setRawDp: (dpId: string, value: unknown) =>
    req<{ status: string; dp_id: string; value: unknown }>(`/api/dp/${dpId}`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }),

  cleanRooms: (room_ids: number[], passes: number) =>
    req<{ status: string; room_ids: number[]; passes: number; packet: PacketSummary }>(
      '/api/clean-rooms',
      {
        method: 'POST',
        body: JSON.stringify({ room_ids, passes }),
      }
    ),

  cleanZones: (zones: DraftZone[]) =>
    req<{ status: string; packet: PacketSummary }>('/api/clean-zones', {
      method: 'POST',
      body: JSON.stringify({
        zones: zones.map((z) => ({
          x1: z.x1,
          y1: z.y1,
          x2: z.x2,
          y2: z.y2,
          passes: z.passes,
        })),
      }),
    }),

  gotoPoint: (x: number, y: number, spot_clean: boolean) =>
    req<{ status: string; packet: PacketSummary }>('/api/goto', {
      method: 'POST',
      body: JSON.stringify({ x, y, spot_clean }),
    }),

  updateRoom: (roomId: number, patch: Partial<Pick<Room, 'name' | 'color' | 'suction' | 'water'>>) =>
    req<{ status: string; room: Room }>(`/api/map/rooms/${roomId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  addNoGoZone: (x1: number, y1: number, x2: number, y2: number, name = 'No-Go Zone') =>
    req<{ status: string }>('/api/map/nogo', {
      method: 'POST',
      body: JSON.stringify({ x1, y1, x2, y2, name }),
    }),

  deleteNoGoZone: (zoneId: string) =>
    req<{ status: string }>(`/api/map/nogo/${zoneId}`, { method: 'DELETE' }),

  addVirtualWall: (x1: number, y1: number, x2: number, y2: number) =>
    req<{ status: string }>('/api/map/vwall', {
      method: 'POST',
      body: JSON.stringify({ x1, y1, x2, y2 }),
    }),

  deleteVirtualWall: (wallId: string) =>
    req<{ status: string }>(`/api/map/vwall/${wallId}`, { method: 'DELETE' }),

  addPoopHazard: (x: number, y: number, radius_px = 10, label = 'Pet Hazard') =>
    req<{ status: string; packet: PacketSummary }>('/api/map/poop', {
      method: 'POST',
      body: JSON.stringify({ x, y, radius_px, label }),
    }),

  deletePoopHazard: (hazardId: string) =>
    req<{ status: string; packet: PacketSummary }>(`/api/map/poop/${hazardId}`, {
      method: 'DELETE',
    }),

  pushNoGo: () => req<{ status: string; packet: PacketSummary }>('/api/map/push-nogo', { method: 'POST' }),

  addCustomPlace: (place: {
    name: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color?: string;
    passes?: number;
  }) =>
    req<{ status: string; place: import('./types').CustomPlace }>('/api/map/places', {
      method: 'POST',
      body: JSON.stringify(place),
    }),

  updateCustomPlace: (placeId: string, patch: { name?: string; color?: string; passes?: number }) =>
    req<{ status: string; place: import('./types').CustomPlace }>(`/api/map/places/${placeId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteCustomPlace: (placeId: string) =>
    req<{ status: string }>(`/api/map/places/${placeId}`, { method: 'DELETE' }),

  resetTrajectory: () => req<{ status: string }>('/api/map/reset-trajectory', { method: 'POST' }),
  syncMap: () => req<{ status: string; synced: boolean; is_real_slam: boolean }>('/api/map/sync', { method: 'POST' }),
};
