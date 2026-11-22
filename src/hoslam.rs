//! 100% Local HoSLAM Live Streamer (TCP Port 9999, Unencrypted, Zero Cloud)
//!
//! Continuously parses:
//!   - b"hoslmap\0" : live probabilistic occupancy grid (width x height, dock, origin)
//!   - b"hoslcac\0" : live cleaned area (f32 m2) + elapsed seconds (u32)
//!   - b"hosltraj"  : live f32 (x, y) robot trajectory & pose (~1 Hz)

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{sleep, timeout};

#[derive(Debug, Clone, Serialize)]
pub struct HoSlamSnapshot {
    pub width: usize,
    pub height: usize,
    pub origin_x: i32, // tenths of a pixel
    pub origin_y: i32,
    pub dock_x: f64,
    pub dock_y: f64,
    pub min_x: usize,
    pub max_x: usize,
    pub min_y: usize,
    pub max_y: usize,
    pub grid_bytes: Vec<u8>,
    pub trajectory: Vec<[f64; 2]>,
    pub robot_x: f64,
    pub robot_y: f64,
    pub robot_heading: f64,
    pub clean_area_m2: f32,
    pub clean_time_s: u32,
}

#[derive(Default)]
struct InnerState {
    snap: Option<HoSlamSnapshot>,
}

#[derive(Clone)]
pub struct HoSlamClient {
    inner: Arc<Mutex<InnerState>>,
}

impl HoSlamClient {
    pub fn spawn(ip: String, port: u16) -> Self {
        let inner = Arc::new(Mutex::new(InnerState::default()));
        let bg = inner.clone();
        tokio::spawn(async move {
            loop {
                let addr = format!("{ip}:{port}");
                if let Ok(Ok(mut stream)) =
                    timeout(Duration::from_secs(4), TcpStream::connect(&addr)).await
                {
                    let _ = stream.write_all(b"\n").await;
                    let mut buf: Vec<u8> = Vec::with_capacity(131_072);
                    let mut chunk = vec![0u8; 65_536];
                    loop {
                        match timeout(Duration::from_secs(4), stream.read(&mut chunk)).await {
                            Ok(Ok(0)) => break,
                            Ok(Ok(n)) => {
                                buf.extend_from_slice(&chunk[..n]);
                                drain_packets(&mut buf, &bg);
                            }
                            Ok(Err(_)) => break,
                            Err(_) => {
                                if stream.write_all(b"\n").await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
                sleep(Duration::from_secs(2)).await;
            }
        });
        Self { inner }
    }

    pub fn snapshot(&self, room_overlay: Option<&[u8]>) -> Option<(HoSlamSnapshot, String)> {
        let g = self.inner.lock().unwrap();
        let snap = g.snap.as_ref()?.clone();
        let mut final_grid = snap.grid_bytes.clone();
        if let Some(overlay) = room_overlay {
            if overlay.len() == final_grid.len() {
                for i in 0..final_grid.len() {
                    if final_grid[i] == 244 {
                        let rv = overlay[i];
                        if rv < 240 && (rv & 3) == 0 {
                            final_grid[i] = rv;
                        }
                    }
                }
            }
        }
        let b64 = B64.encode(&final_grid);
        Some((snap, b64))
    }
}

fn find_hosl(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"hosl")
}

fn drain_packets(buf: &mut Vec<u8>, state: &Arc<Mutex<InnerState>>) {
    loop {
        let Some(idx) = find_hosl(buf) else {
            if buf.len() > 4 {
                let keep = buf.len() - 4;
                buf.drain(..keep);
            }
            return;
        };
        if idx > 0 {
            buf.drain(..idx);
        }
        if buf.len() < 12 {
            return;
        }
        let magic: [u8; 8] = buf[..8].try_into().unwrap();
        let total_len = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        if !(12..=2_000_000).contains(&total_len) {
            buf.drain(..4);
            continue;
        }
        if buf.len() < total_len {
            return;
        }
        let body = buf[12..total_len].to_vec();
        buf.drain(..total_len);

        match &magic {
            b"hoslmap\0" => handle_map(&body, state),
            b"hoslcac\0" => handle_cac(&body, state),
            b"hosltraj" => handle_traj(&body, state),
            _ => {}
        }
    }
}

fn handle_map(body: &[u8], state: &Arc<Mutex<InnerState>>) {
    if body.len() < 24 {
        return;
    }
    let dock_x = u32::from_le_bytes(body[0..4].try_into().unwrap()) as f64;
    let dock_y = u32::from_le_bytes(body[4..8].try_into().unwrap()) as f64;
    let ox = u32::from_le_bytes(body[8..12].try_into().unwrap()) as i32;
    let oy = u32::from_le_bytes(body[12..16].try_into().unwrap()) as i32;
    let w = u32::from_le_bytes(body[16..20].try_into().unwrap()) as usize;
    let h = u32::from_le_bytes(body[20..24].try_into().unwrap()) as usize;
    if w == 0 || h == 0 || body.len() < 24 + w * h {
        return;
    }
    let occ = &body[24..24 + w * h];
    let mut grid = vec![255u8; w * h];
    let (mut min_x, mut max_x, mut min_y, mut max_y) = (w, 0usize, h, 0usize);

    for r in 0..h {
        let row = r * w;
        for c in 0..w {
            let v = occ[row + c];
            if v < 112 {
                grid[row + c] = 249;
                min_x = min_x.min(c);
                max_x = max_x.max(c);
                min_y = min_y.min(r);
                max_y = max_y.max(r);
            } else if v > 136 {
                grid[row + c] = 244;
                min_x = min_x.min(c);
                max_x = max_x.max(c);
                min_y = min_y.min(r);
                max_y = max_y.max(r);
            }
        }
    }
    if min_x >= max_x {
        min_x = 0;
        max_x = w;
        min_y = 0;
        max_y = h;
    }

    let mut g = state.lock().unwrap();
    let prev = g.snap.take();
    let trajectory = prev.as_ref().map(|p| p.trajectory.clone()).unwrap_or_default();
    let (rx, ry, rh) = if let Some(p) = &prev {
        (p.robot_x, p.robot_y, p.robot_heading)
    } else {
        (dock_x, dock_y, 0.0)
    };
    g.snap = Some(HoSlamSnapshot {
        width: w,
        height: h,
        origin_x: ox * 10,
        origin_y: oy * 10,
        dock_x,
        dock_y,
        min_x,
        max_x,
        min_y,
        max_y,
        grid_bytes: grid,
        trajectory,
        robot_x: rx,
        robot_y: ry,
        robot_heading: rh,
        clean_area_m2: prev.as_ref().map(|p| p.clean_area_m2).unwrap_or(0.0),
        clean_time_s: prev.as_ref().map(|p| p.clean_time_s).unwrap_or(0),
    });
}

fn handle_cac(body: &[u8], state: &Arc<Mutex<InnerState>>) {
    if body.len() < 8 {
        return;
    }
    let area = f32::from_le_bytes(body[0..4].try_into().unwrap());
    let secs = u32::from_le_bytes(body[4..8].try_into().unwrap());
    let mut g = state.lock().unwrap();
    if let Some(s) = g.snap.as_mut() {
        s.clean_area_m2 = (area * 100.0).round() / 100.0;
        s.clean_time_s = secs;
    }
}

fn handle_traj(body: &[u8], state: &Arc<Mutex<InnerState>>) {
    let n_floats = body.len() / 4;
    if n_floats < 2 {
        return;
    }
    let mut g = state.lock().unwrap();
    let Some(s) = g.snap.as_mut() else {
        return;
    };
    let ox_px = (s.origin_x as f64) / 10.0;
    let oy_px = (s.origin_y as f64) / 10.0;
    let mut pts = Vec::with_capacity(n_floats / 2);
    for pair in body[..n_floats * 4].chunks_exact(8) {
        let tx = f32::from_le_bytes(pair[0..4].try_into().unwrap()) as f64;
        let ty = f32::from_le_bytes(pair[4..8].try_into().unwrap()) as f64;
        let px = ((ox_px - ty) * 10.0).round() / 10.0;
        let py = ((oy_px - tx) * 10.0).round() / 10.0;
        pts.push([px, py]);
    }
    if let Some(&last) = pts.last() {
        s.robot_x = last[0];
        s.robot_y = last[1];
        if pts.len() >= 2 {
            let prev = pts[pts.len() - 2];
            let dx = last[0] - prev[0];
            let dy = last[1] - prev[1];
            if dx.abs() > 0.05 || dy.abs() > 0.05 {
                s.robot_heading = (dy.atan2(dx).to_degrees() * 10.0).round() / 10.0;
            }
        }
        s.trajectory = pts;
    }
}
