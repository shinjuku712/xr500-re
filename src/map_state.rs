//! Local Floorplan State, Optional Cached LZ4 Room Overlay, and Persistent Map Config
//! (Custom Places, No-Go Zones, Virtual Walls, Poop Hazards, Room Names/Colors).

use crate::hoslam::HoSlamClient;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const PALETTE: &[&str] = &[
    "#38bdf8", "#34d399", "#fbbf24", "#a78bfa", "#f472b6", "#2dd4bf", "#fb7185", "#60a5fa",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub id: u32,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub polygon: Vec<[f64; 2]>,
    #[serde(default)]
    pub label_pos: [f64; 2],
    #[serde(default)]
    pub area_m2: f64,
    #[serde(default = "default_suction")]
    pub suction: String,
    #[serde(default = "default_water")]
    pub water: String,
}

fn default_suction() -> String {
    "normal".into()
}
fn default_water() -> String {
    "closed".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoGoZone {
    pub id: String,
    pub name: String,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualWall {
    pub id: String,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoopHazard {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub radius_px: f64,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPlace {
    pub id: String,
    pub name: String,
    pub color: String,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub area_m2: f64,
    pub passes: u8,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PersistedConfig {
    #[serde(default)]
    real_rooms: Vec<Room>,
    #[serde(default)]
    no_go_zones: Vec<NoGoZone>,
    #[serde(default)]
    virtual_walls: Vec<VirtualWall>,
    #[serde(default)]
    poop_hazards: Vec<PoopHazard>,
    #[serde(default)]
    custom_places: Vec<CustomPlace>,
}

struct CachedOverlay {
    width: usize,
    height: usize,
    origin_x: i32,
    origin_y: i32,
    dock_x: f64,
    dock_y: f64,
    min_x: usize,
    max_x: usize,
    min_y: usize,
    max_y: usize,
    grid: Vec<u8>,
    rooms: Vec<Room>,
}

pub struct MapState {
    config_path: PathBuf,
    hoslam: Option<HoSlamClient>,
    overlay: Option<CachedOverlay>,
    cfg: Mutex<PersistedConfig>,
}

impl MapState {
    pub fn new(robot_ip: Option<String>, simulation: bool) -> Arc<Self> {
        let config_path = PathBuf::from("docs/map_config.json");
        let persisted = load_persisted(&config_path);
        let overlay = load_local_lay_bin(Path::new("docs/real_lay.bin"));
        let hoslam = if !simulation {
            robot_ip.map(|ip| HoSlamClient::spawn(ip, 9999))
        } else {
            None
        };
        Arc::new(Self {
            config_path,
            hoslam,
            overlay,
            cfg: Mutex::new(persisted),
        })
    }

    fn save(&self, cfg: &PersistedConfig) {
        if let Some(parent) = self.config_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(cfg) {
            let _ = fs::write(&self.config_path, text);
        }
    }

    fn merged_rooms(&self, base_rooms: &[Room], cfg: &PersistedConfig) -> Vec<Room> {
        let saved: HashMap<u32, &Room> = cfg.real_rooms.iter().map(|r| (r.id, r)).collect();
        base_rooms
            .iter()
            .map(|r| {
                let mut out = r.clone();
                if let Some(s) = saved.get(&r.id) {
                    out.name = s.name.clone();
                    out.color = s.color.clone();
                    out.suction = s.suction.clone();
                    out.water = s.water.clone();
                }
                out
            })
            .collect()
    }

    pub fn pixel_to_tuya(&self, px: f64, py: f64) -> (i16, i16) {
        let (ox, oy) = if let Some(h) = &self.hoslam {
            if let Some((snap, _)) = h.snapshot(None) {
                (snap.origin_x as f64, snap.origin_y as f64)
            } else if let Some(ov) = &self.overlay {
                (ov.origin_x as f64, ov.origin_y as f64)
            } else {
                (450.0, 620.0)
            }
        } else if let Some(ov) = &self.overlay {
            (ov.origin_x as f64, ov.origin_y as f64)
        } else {
            (450.0, 620.0)
        };
        let tx = (px * 10.0 - ox).round().clamp(-32768.0, 32767.0) as i16;
        let ty = (oy - py * 10.0).round().clamp(-32768.0, 32767.0) as i16;
        (tx, ty)
    }

    pub fn to_api_json(&self, is_moving: bool) -> Value {
        let cfg = self.cfg.lock().unwrap();
        let overlay_bytes = self.overlay.as_ref().map(|o| o.grid.as_slice());
        let base_rooms = self
            .overlay
            .as_ref()
            .map(|o| o.rooms.as_slice())
            .unwrap_or(&[]);
        let rooms = self.merged_rooms(base_rooms, &cfg);

        if let Some(h) = &self.hoslam {
            if let Some((snap, grid_b64)) = h.snapshot(overlay_bytes) {
                return json!({
                    "floorplan": {
                        "is_real_slam": true,
                        "source": "local_hoslam_9999",
                        "width": snap.width,
                        "height": snap.height,
                        "origin_x": snap.origin_x,
                        "origin_y": snap.origin_y,
                        "resolution_cm": 5,
                        "dock": { "x": snap.dock_x, "y": snap.dock_y, "heading": 0 },
                        "bounds": {
                            "min_x": snap.min_x, "max_x": snap.max_x,
                            "min_y": snap.min_y, "max_y": snap.max_y
                        },
                        "grid_b64": grid_b64,
                        "rooms": rooms,
                        "walls": [],
                        "obstacles": [],
                        "no_go_zones": cfg.no_go_zones,
                        "virtual_walls": cfg.virtual_walls,
                        "poop_hazards": cfg.poop_hazards,
                        "custom_places": cfg.custom_places
                    },
                    "robot": {
                        "x": snap.robot_x,
                        "y": snap.robot_y,
                        "heading": snap.robot_heading,
                        "speed_cm_s": 55.0,
                        "is_moving": is_moving,
                        "mission_type": if is_moving { "cleaning" } else { "idle" },
                        "active_rooms": [],
                        "active_zones": [],
                        "target_pin": null
                    },
                    "trajectory": snap.trajectory
                });
            }
        }

        if let Some(ov) = &self.overlay {
            return json!({
                "floorplan": {
                    "is_real_slam": true,
                    "source": "local_cache",
                    "width": ov.width,
                    "height": ov.height,
                    "origin_x": ov.origin_x,
                    "origin_y": ov.origin_y,
                    "resolution_cm": 5,
                    "dock": { "x": ov.dock_x, "y": ov.dock_y, "heading": 0 },
                    "bounds": {
                        "min_x": ov.min_x, "max_x": ov.max_x,
                        "min_y": ov.min_y, "max_y": ov.max_y
                    },
                    "grid_b64": B64.encode(&ov.grid),
                    "rooms": rooms,
                    "walls": [],
                    "obstacles": [],
                    "no_go_zones": cfg.no_go_zones,
                    "virtual_walls": cfg.virtual_walls,
                    "poop_hazards": cfg.poop_hazards,
                    "custom_places": cfg.custom_places
                },
                "robot": {
                    "x": ov.dock_x, "y": ov.dock_y, "heading": 0.0,
                    "speed_cm_s": 55.0, "is_moving": is_moving,
                    "mission_type": "idle", "active_rooms": [],
                    "active_zones": [], "target_pin": null
                },
                "trajectory": [[ov.dock_x, ov.dock_y]]
            });
        }

        // Empty floorplan fallback when no robot is reachable yet
        json!({
            "floorplan": {
                "is_real_slam": false,
                "resolution_cm": 5,
                "dock": { "x": 0.0, "y": 0.0, "heading": 0 },
                "bounds": { "min_x": -200, "max_x": 200, "min_y": -200, "max_y": 200 },
                "rooms": [],
                "walls": [],
                "obstacles": [],
                "no_go_zones": cfg.no_go_zones,
                "virtual_walls": cfg.virtual_walls,
                "poop_hazards": cfg.poop_hazards,
                "custom_places": cfg.custom_places
            },
            "robot": {
                "x": 0.0, "y": 0.0, "heading": 0.0,
                "speed_cm_s": 55.0, "is_moving": false,
                "mission_type": "idle", "active_rooms": [],
                "active_zones": [], "target_pin": null
            },
            "trajectory": []
        })
    }

    pub fn update_room(
        &self,
        room_id: u32,
        name: Option<String>,
        color: Option<String>,
        suction: Option<String>,
        water: Option<String>,
    ) -> Option<Room> {
        let mut cfg = self.cfg.lock().unwrap();
        let base_rooms = self
            .overlay
            .as_ref()
            .map(|o| o.rooms.as_slice())
            .unwrap_or(&[]);
        let mut merged = self.merged_rooms(base_rooms, &cfg);
        let target = merged.iter_mut().find(|r| r.id == room_id)?;
        if let Some(n) = name.filter(|s| !s.trim().is_empty()) {
            target.name = n.trim().to_string();
        }
        if let Some(c) = color.filter(|s| !s.trim().is_empty()) {
            target.color = c.trim().to_string();
        }
        if let Some(s) = suction {
            target.suction = s;
        }
        if let Some(w) = water {
            target.water = w;
        }
        let updated = target.clone();
        cfg.real_rooms = merged;
        self.save(&cfg);
        Some(updated)
    }

    pub fn add_nogo(&self, x1: f64, y1: f64, x2: f64, y2: f64, name: String) -> NoGoZone {
        let mut cfg = self.cfg.lock().unwrap();
        let z = NoGoZone {
            id: Uuid::new_v4().to_string()[..8].to_string(),
            name,
            x1: x1.min(x2),
            y1: y1.min(y2),
            x2: x1.max(x2),
            y2: y1.max(y2),
        };
        cfg.no_go_zones.push(z.clone());
        self.save(&cfg);
        z
    }

    pub fn delete_nogo(&self, id: &str) -> bool {
        let mut cfg = self.cfg.lock().unwrap();
        let before = cfg.no_go_zones.len();
        cfg.no_go_zones.retain(|z| z.id != id);
        if cfg.no_go_zones.len() != before {
            self.save(&cfg);
            true
        } else {
            false
        }
    }

    pub fn add_vwall(&self, x1: f64, y1: f64, x2: f64, y2: f64) -> VirtualWall {
        let mut cfg = self.cfg.lock().unwrap();
        let w = VirtualWall {
            id: Uuid::new_v4().to_string()[..8].to_string(),
            x1,
            y1,
            x2,
            y2,
        };
        cfg.virtual_walls.push(w.clone());
        self.save(&cfg);
        w
    }

    pub fn delete_vwall(&self, id: &str) -> bool {
        let mut cfg = self.cfg.lock().unwrap();
        let before = cfg.virtual_walls.len();
        cfg.virtual_walls.retain(|w| w.id != id);
        if cfg.virtual_walls.len() != before {
            self.save(&cfg);
            true
        } else {
            false
        }
    }

    pub fn add_poop(&self, x: f64, y: f64, radius_px: f64, label: String) -> PoopHazard {
        let mut cfg = self.cfg.lock().unwrap();
        let h = PoopHazard {
            id: Uuid::new_v4().to_string()[..8].to_string(),
            x,
            y,
            radius_px,
            label,
            created_at: Local::now().format("%H:%M").to_string(),
        };
        cfg.poop_hazards.push(h.clone());
        self.save(&cfg);
        h
    }

    pub fn delete_poop(&self, id: &str) -> bool {
        let mut cfg = self.cfg.lock().unwrap();
        let before = cfg.poop_hazards.len();
        cfg.poop_hazards.retain(|h| h.id != id);
        if cfg.poop_hazards.len() != before {
            self.save(&cfg);
            true
        } else {
            false
        }
    }

    pub fn add_place(
        &self,
        name: String,
        color: String,
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        passes: u8,
    ) -> CustomPlace {
        let mut cfg = self.cfg.lock().unwrap();
        let (min_x, max_x) = (x1.min(x2), x1.max(x2));
        let (min_y, max_y) = (y1.min(y2), y1.max(y2));
        let area_m2 = (((max_x - min_x) * 0.05 * (max_y - min_y) * 0.05) * 10.0).round() / 10.0;
        let p = CustomPlace {
            id: Uuid::new_v4().to_string()[..8].to_string(),
            name: if name.trim().is_empty() {
                "Corridor".into()
            } else {
                name.trim().into()
            },
            color,
            x1: min_x,
            y1: min_y,
            x2: max_x,
            y2: max_y,
            area_m2,
            passes: passes.clamp(1, 2),
        };
        cfg.custom_places.push(p.clone());
        self.save(&cfg);
        p
    }

    pub fn update_place(
        &self,
        id: &str,
        name: Option<String>,
        color: Option<String>,
        passes: Option<u8>,
    ) -> Option<CustomPlace> {
        let mut cfg = self.cfg.lock().unwrap();
        let p = cfg.custom_places.iter_mut().find(|p| p.id == id)?;
        if let Some(n) = name.filter(|s| !s.trim().is_empty()) {
            p.name = n.trim().into();
        }
        if let Some(c) = color.filter(|s| !s.trim().is_empty()) {
            p.color = c.trim().into();
        }
        if let Some(pass) = passes {
            p.passes = pass.clamp(1, 2);
        }
        let cloned = p.clone();
        self.save(&cfg);
        Some(cloned)
    }

    pub fn delete_place(&self, id: &str) -> bool {
        let mut cfg = self.cfg.lock().unwrap();
        let before = cfg.custom_places.len();
        cfg.custom_places.retain(|p| p.id != id);
        if cfg.custom_places.len() != before {
            self.save(&cfg);
            true
        } else {
            false
        }
    }

    pub fn all_nogo_tuya_boxes(&self) -> Vec<(i16, i16, i16, i16)> {
        let cfg = self.cfg.lock().unwrap();
        let mut boxes = Vec::new();
        for ng in &cfg.no_go_zones {
            let (tx1, ty1) = self.pixel_to_tuya(ng.x1, ng.y1);
            let (tx2, ty2) = self.pixel_to_tuya(ng.x2, ng.y2);
            boxes.push((tx1.min(tx2), ty1.min(ty2), tx1.max(tx2), ty1.max(ty2)));
        }
        for h in &cfg.poop_hazards {
            let r = h.radius_px;
            let (tx1, ty1) = self.pixel_to_tuya(h.x - r, h.y - r);
            let (tx2, ty2) = self.pixel_to_tuya(h.x + r, h.y + r);
            boxes.push((tx1.min(tx2), ty1.min(ty2), tx1.max(tx2), ty1.max(ty2)));
        }
        boxes
    }
}

fn load_persisted(path: &Path) -> PersistedConfig {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Optional local-only decoder for cached docs/real_lay.bin (adds colored room partitions onto HoSLAM).
fn load_local_lay_bin(path: &Path) -> Option<CachedOverlay> {
    let raw = fs::read(path).ok()?;
    if raw.len() < 24 {
        return None;
    }
    let w = u16::from_be_bytes(raw[4..6].try_into().ok()?) as usize;
    let h = u16::from_be_bytes(raw[6..8].try_into().ok()?) as usize;
    let ox = u16::from_be_bytes(raw[8..10].try_into().ok()?) as i32;
    let oy = u16::from_be_bytes(raw[10..12].try_into().ok()?) as i32;
    let res_cm = u16::from_be_bytes(raw[12..14].try_into().ok()?) as f64;
    let cx = u16::from_be_bytes(raw[14..16].try_into().ok()?) as f64 / 10.0;
    let cy = u16::from_be_bytes(raw[16..18].try_into().ok()?) as f64 / 10.0;
    let uncomp_len = u32::from_be_bytes(raw[18..22].try_into().ok()?) as usize;
    let comp_len = u16::from_be_bytes(raw[22..24].try_into().ok()?) as usize;
    if raw.len() < 24 + comp_len || w == 0 || h == 0 {
        return None;
    }
    let payload =
        lz4_flex::block::decompress(&raw[24..24 + comp_len], uncomp_len.max(w * h + 16384)).ok()?;
    if payload.len() < w * h {
        return None;
    }
    let grid = payload[..w * h].to_vec();

    let (mut min_x, mut max_x, mut min_y, mut max_y) = (w, 0usize, h, 0usize);
    let mut stats: HashMap<u32, (f64, f64, f64)> = HashMap::new();
    for r in 0..h {
        let row = r * w;
        for c in 0..w {
            let v = grid[row + c];
            if v != 255 {
                min_x = min_x.min(c);
                max_x = max_x.max(c);
                min_y = min_y.min(r);
                max_y = max_y.max(r);
            }
            if v < 240 && (v & 3) == 0 {
                let rid = (v >> 2) as u32;
                let e = stats.entry(rid).or_insert((0.0, 0.0, 0.0));
                e.0 += c as f64;
                e.1 += r as f64;
                e.2 += 1.0;
            }
        }
    }
    if min_x >= max_x {
        min_x = 0;
        max_x = w;
        min_y = 0;
        max_y = h;
    }

    let mut rids: Vec<u32> = stats.keys().copied().collect();
    rids.sort_unstable();
    let rooms = rids
        .into_iter()
        .map(|rid| {
            let (sx, sy, cnt) = stats[&rid];
            let area = ((cnt * res_cm * res_cm / 10000.0) * 10.0).round() / 10.0;
            Room {
                id: rid,
                name: format!("Room {}", rid + 1),
                color: PALETTE[(rid as usize) % PALETTE.len()].to_string(),
                polygon: vec![],
                label_pos: [((sx / cnt) * 10.0).round() / 10.0, ((sy / cnt) * 10.0).round() / 10.0],
                area_m2: area,
                suction: "normal".into(),
                water: "closed".into(),
            }
        })
        .collect();

    Some(CachedOverlay {
        width: w,
        height: h,
        origin_x: ox,
        origin_y: oy,
        dock_x: cx,
        dock_y: cy,
        min_x,
        max_x,
        min_y,
        max_y,
        grid,
        rooms,
    })
}
