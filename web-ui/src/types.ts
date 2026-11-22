export type ToolMode = 'rooms' | 'place' | 'zone' | 'brush' | 'pin' | 'poop' | 'nogo' | 'vwall' | 'pan';

export interface ConsumableInfo {
  remaining: number;
  max: number;
}

export interface RobotStatus {
  online: boolean;
  simulation: boolean;
  error?: string | null;
  profile: string;
  ip: string;
  power: boolean;
  mode: string;
  status: string;
  suction: string;
  water_level: string;
  battery: number;
  clean_area_m2: number;
  clean_time_min: number;
  fault_code: number;
  fault_messages: string[];
  locate: boolean;
  volume?: number;
  dnd?: boolean;
  break_clean?: boolean;
  y_mop?: boolean;
  custom_mode?: boolean;
  consumables?: {
    edge_brush: ConsumableInfo;
    roll_brush: ConsumableInfo;
    filter: ConsumableInfo;
    duster_cloth: ConsumableInfo;
  };
  raw_dps: Record<string, unknown>;
}

export interface Room {
  id: number;
  name: string;
  color: string;
  polygon: [number, number][];
  label_pos: [number, number];
  area_m2: number;
  suction: string;
  water: string;
}

export interface Obstacle {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoGoZone {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface VirtualWall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PoopHazard {
  id: string;
  x: number;
  y: number;
  radius_px: number;
  label: string;
  created_at: string;
}

export interface CustomPlace {
  id: string;
  name: string;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  area_m2: number;
  passes: number;
}

export interface DraftZone {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  passes: number;
  source?: 'rect' | 'brush';
}

export interface TargetPin {
  x: number;
  y: number;
  spot_clean: boolean;
}

export interface SavedPreset {
  id: string;
  name: string;
  kind: 'rooms' | 'zones';
  roomIds?: number[];
  zones?: DraftZone[];
  passes: number;
}

export interface Floorplan {
  name?: string;
  is_real_slam?: boolean;
  map_id?: number;
  width?: number;
  height?: number;
  origin_x?: number;
  origin_y?: number;
  grid_b64?: string;
  resolution_cm: number;
  bounds: { min_x: number; max_x: number; min_y: number; max_y: number };
  dock: { x: number; y: number; heading: number };
  rooms: Room[];
  walls: [number, number, number, number][];
  obstacles: Obstacle[];
  no_go_zones: NoGoZone[];
  virtual_walls: VirtualWall[];
  poop_hazards?: PoopHazard[];
  custom_places?: CustomPlace[];
}

export interface RobotPose {
  x: number;
  y: number;
  heading: number;
  speed_cm_s: number;
  is_moving: boolean;
  mission_type: string;
  active_rooms: number[];
  active_zones: DraftZone[];
  target_pin: TargetPin | null;
}

export interface MapState {
  floorplan: Floorplan;
  robot: RobotPose;
  trajectory: [number, number][];
}

export interface RawDpsResponse {
  dps: Record<string, unknown>;
  schema: Record<string, { code?: string; name?: string; type?: string; description?: string }>;
  profile: string;
  simulation: boolean;
}

export interface DispatchedPacket {
  id: string;
  timestamp: string;
  label: string;
  dp: number;
  base64: string;
  hex: string;
  bytes: number;
}
