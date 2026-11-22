//! Native Rust Tuya Local Protocol v3.3 (TCP port 6668) + UDP 6667 LAN Scanner
//! + Hardware-Verified Liectroux XR500T3 DP 15 (0xAA) Clockwise Polygon Commands.

use aes::Aes128;
use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use ecb::cipher::{BlockDecryptMut, BlockEncryptMut, KeyInit, block_padding::Pkcs7};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::time::timeout;

type Aes128EcbEnc = ecb::Encryptor<Aes128>;
type Aes128EcbDec = ecb::Decryptor<Aes128>;

const PREFIX: u32 = 0x0000_55AA;
const SUFFIX: u32 = 0x0000_AA55;
const CMD_CONTROL: u32 = 0x07;
const CMD_STATUS: u32 = 0x08;
const CMD_DP_QUERY: u32 = 0x0A;
const V33_HEADER: [u8; 15] = [b'3', b'.', b'3', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredDevice {
    pub ip: String,
    pub device_id: String,
    pub version: String,
    pub product_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PacketSummary {
    pub dp: u32,
    pub base64: String,
    pub hex: String,
    pub bytes: usize,
}

#[derive(Debug, Clone)]
pub struct TuyaConfig {
    pub ip: String,
    pub device_id: String,
    pub local_key: String,
    pub port: u16,
    pub simulation: bool,
}

impl TuyaConfig {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();
        let ip = std::env::var("DEVICE_IP").unwrap_or_else(|_| "192.168.1.100".into());
        let device_id = std::env::var("DEVICE_ID").unwrap_or_default();
        let local_key = std::env::var("LOCAL_KEY").unwrap_or_default();
        let port = std::env::var("DEVICE_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(6668);
        let simulation = std::env::var("SIMULATION_MODE")
            .map(|v| matches!(v.to_lowercase().as_str(), "true" | "1" | "yes"))
            .unwrap_or(false);
        Self {
            ip,
            device_id,
            local_key,
            port,
            simulation,
        }
    }
}

pub struct TuyaClient {
    pub cfg: TuyaConfig,
    seq: Mutex<u32>,
    last_dps: Arc<Mutex<Map<String, Value>>>,
    has_connected: Arc<Mutex<bool>>,
    io_lock: tokio::sync::Mutex<()>,
}

impl TuyaClient {
    pub fn new(cfg: TuyaConfig) -> Self {
        let mut init = Map::new();
        if cfg.simulation {
            init.insert("1".into(), json!(false));
            init.insert("2".into(), json!(false));
            init.insert("4".into(), json!("chargego"));
            init.insert("5".into(), json!("charging"));
            init.insert("6".into(), json!(32));
            init.insert("7".into(), json!(24));
            init.insert("8".into(), json!(85));
            init.insert("9".into(), json!("normal"));
            init.insert("10".into(), json!("closed"));
            init.insert("17".into(), json!(140));
            init.insert("19".into(), json!(210));
            init.insert("21".into(), json!(85));
            init.insert("23".into(), json!(95));
            init.insert("25".into(), json!(false));
            init.insert("26".into(), json!(80));
            init.insert("27".into(), json!(false));
            init.insert("28".into(), json!(0));
            init.insert("104".into(), json!(false));
            init.insert("105".into(), json!(true));
        }
        Self {
            cfg,
            seq: Mutex::new(1),
            last_dps: Arc::new(Mutex::new(init)),
            has_connected: Arc::new(Mutex::new(false)),
            io_lock: tokio::sync::Mutex::new(()),
        }
    }

    fn next_seq(&self) -> u32 {
        let mut g = self.seq.lock().unwrap();
        let s = *g;
        *g = g.wrapping_add(1);
        s
    }

    fn key_bytes(&self) -> Result<[u8; 16]> {
        let b = self.cfg.local_key.as_bytes();
        if b.len() != 16 {
            return Err(anyhow!(
                "LOCAL_KEY must be 16 bytes (got {} bytes)",
                b.len()
            ));
        }
        let mut out = [0u8; 16];
        out.copy_from_slice(b);
        Ok(out)
    }

    fn encrypt_ecb(key: &[u8; 16], plain: &[u8]) -> Result<Vec<u8>> {
        let enc = Aes128EcbEnc::new(key.into());
        let mut buf = vec![0u8; plain.len() + 16];
        buf[..plain.len()].copy_from_slice(plain);
        let ct = enc
            .encrypt_padded_mut::<Pkcs7>(&mut buf, plain.len())
            .map_err(|_| anyhow!("AES-128-ECB encrypt failed"))?;
        Ok(ct.to_vec())
    }

    fn decrypt_ecb(key: &[u8; 16], cipher: &[u8]) -> Result<Vec<u8>> {
        if cipher.is_empty() || cipher.len() % 16 != 0 {
            return Err(anyhow!("Invalid ciphertext length {}", cipher.len()));
        }
        let dec = Aes128EcbDec::new(key.into());
        let mut buf = cipher.to_vec();
        let pt = dec
            .decrypt_padded_mut::<Pkcs7>(&mut buf)
            .map_err(|_| anyhow!("AES-128-ECB decrypt failed (wrong LOCAL_KEY?)"))?;
        Ok(pt.to_vec())
    }

    fn build_frame(&self, cmd: u32, payload: &[u8]) -> Vec<u8> {
        let seq = self.next_seq();
        let len_field = (payload.len() + 8) as u32; // payload + crc32(4) + suffix(4)
        let mut frame = Vec::with_capacity(16 + payload.len() + 8);
        frame.extend_from_slice(&PREFIX.to_be_bytes());
        frame.extend_from_slice(&seq.to_be_bytes());
        frame.extend_from_slice(&cmd.to_be_bytes());
        frame.extend_from_slice(&len_field.to_be_bytes());
        frame.extend_from_slice(payload);
        let crc = crc32fast::hash(&frame);
        frame.extend_from_slice(&crc.to_be_bytes());
        frame.extend_from_slice(&SUFFIX.to_be_bytes());
        frame
    }

    fn parse_response_dps(&self, key: &[u8; 16], buf: &[u8]) -> Option<Map<String, Value>> {
        let mut pos = 0;
        let mut merged = Map::new();
        while pos + 20 <= buf.len() {
            if u32::from_be_bytes(buf[pos..pos + 4].try_into().ok()?) != PREFIX {
                pos += 1;
                continue;
            }
            let cmd = u32::from_be_bytes(buf[pos + 8..pos + 12].try_into().ok()?);
            let len = u32::from_be_bytes(buf[pos + 12..pos + 16].try_into().ok()?) as usize;
            let end = pos + 16 + len;
            if end > buf.len() || len < 12 {
                break;
            }
            // Body after 4-byte return code, before 8-byte crc+suffix
            let mut body = &buf[pos + 20..end - 8];
            if (cmd == CMD_STATUS || body.starts_with(b"3.3")) && body.len() >= 15 {
                body = &body[15..];
            }
            if !body.is_empty() {
                if let Ok(plain) = Self::decrypt_ecb(key, body) {
                    if let Ok(val) = serde_json::from_slice::<Value>(&plain) {
                        if let Some(dps) = val.get("dps").and_then(|d| d.as_object()) {
                            for (k, v) in dps {
                                merged.insert(k.clone(), v.clone());
                            }
                        }
                    }
                }
            }
            pos = end;
        }
        if merged.is_empty() { None } else { Some(merged) }
    }

    async fn exchange(&self, cmd: u32, json_body: Value, add_v33_header: bool) -> Result<Option<Map<String, Value>>> {
        let _guard = self.io_lock.lock().await;
        let key = self.key_bytes()?;
        let plain = serde_json::to_vec(&json_body)?;
        let enc = Self::encrypt_ecb(&key, &plain)?;
        let mut payload = Vec::with_capacity(enc.len() + 15);
        if add_v33_header {
            payload.extend_from_slice(&V33_HEADER);
        }
        payload.extend_from_slice(&enc);
        let frame = self.build_frame(cmd, &payload);

        let addr = format!("{}:{}", self.cfg.ip, self.cfg.port);
        let mut stream = timeout(Duration::from_secs(3), TcpStream::connect(&addr))
            .await
            .context("TCP connect timeout on port 6668")?
            .context("TCP connect failed on port 6668")?;

        stream.write_all(&frame).await?;
        let mut resp = vec![0u8; 4096];
        let n = match timeout(Duration::from_millis(1800), stream.read(&mut resp)).await {
            Ok(Ok(n)) => n,
            _ => 0,
        };
        if n > 0 {
            if let Some(dps) = self.parse_response_dps(&key, &resp[..n]) {
                let mut cache = self.last_dps.lock().unwrap();
                for (k, v) in &dps {
                    cache.insert(k.clone(), v.clone());
                }
                *self.has_connected.lock().unwrap() = true;
                return Ok(Some(dps));
            }
        }
        Ok(None)
    }

    fn now_ts() -> String {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_string()
    }

    pub fn cached_status_str(&self) -> String {
        self.last_dps
            .lock()
            .unwrap()
            .get("5")
            .and_then(|v| v.as_str())
            .unwrap_or("standby")
            .to_lowercase()
    }

    pub async fn get_raw_dps(&self) -> (Map<String, Value>, bool, Option<String>) {
        if self.cfg.simulation {
            return (self.last_dps.lock().unwrap().clone(), true, None);
        }
        let body = json!({
            "gwId": self.cfg.device_id,
            "devId": self.cfg.device_id,
            "uid": self.cfg.device_id,
            "t": Self::now_ts(),
        });
        match self.exchange(CMD_DP_QUERY, body, false).await {
            Ok(_) => {
                let dps = self.last_dps.lock().unwrap().clone();
                let online = *self.has_connected.lock().unwrap();
                (dps, online, None)
            }
            Err(e) => {
                let dps = self.last_dps.lock().unwrap().clone();
                let online = *self.has_connected.lock().unwrap();
                (dps, online, Some(e.to_string()))
            }
        }
    }

    pub async fn get_status_json(&self) -> Value {
        let (dps, online, err) = self.get_raw_dps().await;
        let str_or = |k: &str, d: &str| {
            dps.get(k)
                .and_then(|v| v.as_str())
                .unwrap_or(d)
                .to_string()
        };
        let int_or = |k: &str, d: i64| dps.get(k).and_then(|v| v.as_i64()).unwrap_or(d);
        let bool_or = |k: &str| dps.get(k).and_then(|v| v.as_bool()).unwrap_or(false);

        json!({
            "online": online,
            "simulation": self.cfg.simulation,
            "error": err,
            "profile": "T3",
            "ip": self.cfg.ip,
            "power": bool_or("1"),
            "mode": str_or("4", "standby"),
            "status": str_or("5", "standby"),
            "suction": str_or("9", "normal"),
            "water_level": str_or("10", "closed"),
            "battery": int_or("8", 0),
            "clean_area_m2": int_or("7", 0),
            "clean_time_min": int_or("6", 0),
            "fault_code": int_or("28", 0),
            "fault_messages": [],
            "locate": bool_or("11"),
            "volume": int_or("26", 80),
            "dnd": bool_or("25"),
            "break_clean": bool_or("27"),
            "y_mop": bool_or("104"),
            "custom_mode": bool_or("105"),
            "consumables": {
                "edge_brush": { "remaining": int_or("17", 0), "max": 200 },
                "roll_brush": { "remaining": int_or("19", 0), "max": 300 },
                "filter": { "remaining": int_or("21", 0), "max": 120 },
                "duster_cloth": { "remaining": int_or("23", 0), "max": 120 }
            },
            "raw_dps": dps
        })
    }

    pub async fn set_dps(&self, dps: Map<String, Value>) -> Result<()> {
        if self.cfg.simulation {
            let mut cache = self.last_dps.lock().unwrap();
            for (k, v) in dps {
                cache.insert(k, v);
            }
            return Ok(());
        }
        let body = json!({
            "devId": self.cfg.device_id,
            "uid": self.cfg.device_id,
            "t": Self::now_ts(),
            "dps": dps,
        });
        self.exchange(CMD_CONTROL, body, true).await?;
        Ok(())
    }

    pub async fn set_dp(&self, dp: u32, val: Value) -> Result<()> {
        let mut m = Map::new();
        m.insert(dp.to_string(), val);
        self.set_dps(m).await
    }

    /// Pack Tuya Laser Sweeper DP 15 (command_trans) frame:
    /// [0xAA][len_hi][len_lo][cmd][...data][checksum = sum(cmd + data) & 0xFF]
    pub fn pack_laser_frame(cmd: u8, data: &[u8]) -> Vec<u8> {
        let body_len = (1 + data.len()) as u16;
        let mut sum: u32 = cmd as u32;
        for &b in data {
            sum += b as u32;
        }
        let chk = (sum & 0xFF) as u8;
        let mut out = Vec::with_capacity(4 + data.len() + 1);
        out.push(0xAA);
        out.extend_from_slice(&body_len.to_be_bytes());
        out.push(cmd);
        out.extend_from_slice(data);
        out.push(chk);
        out
    }

    fn summarize(dp: u32, frame: &[u8]) -> PacketSummary {
        PacketSummary {
            dp,
            base64: B64.encode(frame),
            hex: frame
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<Vec<_>>()
                .join(" "),
            bytes: frame.len(),
        }
    }

    pub async fn clean_rooms(&self, room_ids: &[u8], passes: u8) -> Result<PacketSummary> {
        let mut data = Vec::with_capacity(2 + room_ids.len());
        data.push(passes.clamp(1, 2));
        data.push(room_ids.len() as u8);
        data.extend_from_slice(room_ids);
        let frame = Self::pack_laser_frame(0x14, &data);
        let pkt = Self::summarize(15, &frame);
        self.set_dp(15, json!(pkt.base64)).await?;
        Ok(pkt)
    }

    /// Hardware-verified CW polygon Zone Clean (DP 15 cmd 0x28).
    /// Expands 2x passes into repeated polygons so XR500T3 firmware executes both passes.
    pub async fn clean_zones(&self, zones: &[(i16, i16, i16, i16, u8)]) -> Result<PacketSummary> {
        let mut expanded = Vec::new();
        for &(x1, y1, x2, y2, passes) in zones {
            for _ in 0..passes.clamp(1, 2) {
                expanded.push((x1, y1, x2, y2));
            }
        }
        let mut data = Vec::with_capacity(2 + expanded.len() * 17);
        data.push(1u8);
        data.push(expanded.len() as u8);
        for (x1, y1, x2, y2) in expanded {
            data.push(4u8); // vertex_count = 4, CLOCKWISE order!
            for v in [x1, y2, x2, y2, x2, y1, x1, y1] {
                data.extend_from_slice(&v.to_be_bytes());
            }
        }
        let frame = Self::pack_laser_frame(0x28, &data);
        let pkt = Self::summarize(15, &frame);
        self.set_dp(15, json!(pkt.base64)).await?;
        Ok(pkt)
    }

    pub async fn goto_point(&self, x: i16, y: i16) -> Result<PacketSummary> {
        let mut data = Vec::with_capacity(4);
        data.extend_from_slice(&x.to_be_bytes());
        data.extend_from_slice(&y.to_be_bytes());
        let frame = Self::pack_laser_frame(0x16, &data);
        let pkt = Self::summarize(15, &frame);
        self.set_dp(15, json!(pkt.base64)).await?;
        Ok(pkt)
    }

    /// Push all No-Go / Poop Hazard exclusion boxes (DP 15 cmd 0x1A, CW polygons).
    pub async fn push_nogo_zones(&self, boxes: &[(i16, i16, i16, i16)]) -> Result<PacketSummary> {
        let mut data = Vec::with_capacity(1 + boxes.len() * 18);
        data.push(boxes.len() as u8);
        for &(x1, y1, x2, y2) in boxes {
            data.push(0u8); // mode 0 = full forbidden
            data.push(4u8); // vertex_count = 4, CW
            for v in [x1, y2, x2, y2, x2, y1, x1, y1] {
                data.extend_from_slice(&v.to_be_bytes());
            }
        }
        let frame = Self::pack_laser_frame(0x1A, &data);
        let pkt = Self::summarize(15, &frame);
        self.set_dp(15, json!(pkt.base64)).await?;
        Ok(pkt)
    }
}

/// Listen on UDP port 6667 for Tuya v3.3 encrypted LAN broadcasts (zero cloud).
pub async fn scan_lan(duration_secs: u64) -> Result<Vec<DiscoveredDevice>> {
    let sock = UdpSocket::bind("0.0.0.0:6667").await?;
    sock.set_broadcast(true)?;
    let udp_key_arr = Md5::digest(b"yGAdlopoPVldABfn");
    let mut key = [0u8; 16];
    key.copy_from_slice(&udp_key_arr);

    let mut found: HashMap<String, DiscoveredDevice> = HashMap::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(duration_secs);
    let mut buf = [0u8; 2048];

    while tokio::time::Instant::now() < deadline {
        let rem = deadline.saturating_duration_since(tokio::time::Instant::now());
        match timeout(rem, sock.recv_from(&mut buf)).await {
            Ok(Ok((n, src))) if n > 28 => {
                let cipher = &buf[20..n - 8];
                if let Ok(plain) = TuyaClient::decrypt_ecb(&key, cipher) {
                    if let Ok(v) = serde_json::from_slice::<Value>(&plain) {
                        let ip = v
                            .get("ip")
                            .and_then(|s| s.as_str())
                            .map(String::from)
                            .unwrap_or_else(|| match src {
                                SocketAddr::V4(a) => a.ip().to_string(),
                                SocketAddr::V6(a) => a.ip().to_string(),
                            });
                        let id = v
                            .get("gwId")
                            .or_else(|| v.get("id"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let version = v
                            .get("version")
                            .and_then(|s| s.as_str())
                            .unwrap_or("3.3")
                            .to_string();
                        let product_key = v
                            .get("productKey")
                            .and_then(|s| s.as_str())
                            .unwrap_or("")
                            .to_string();
                        found.insert(
                            ip.clone(),
                            DiscoveredDevice {
                                ip,
                                device_id: id,
                                version,
                                product_key,
                            },
                        );
                    }
                }
            }
            _ => break,
        }
    }

    Ok(found.into_values().collect())
}
