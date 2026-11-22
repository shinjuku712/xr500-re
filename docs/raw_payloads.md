# Liectroux XR500 Decoded Raw & Binary Data Points (DPs)

This document describes the binary / Base64-encoded payload structures used by the **Liectroux XR500** (OEM: Xiamen Lilin Electronics, T2 & T3 mainboards) running over the Tuya Local Protocol (port 6668).

---

## 1. Encoding Conventions & Framing

Tuya `Raw` type DPs are exchanged as **Base64 strings** inside the JSON protocol packet:
```json
{
  "dps": {
    "101": "AQACAAEAAg=="
  }
}
```
When decoded from Base64 to raw bytes, Lilin vacuum firmware employs packed binary structs (mostly **big-endian `>`**, with coordinate offsets centered on the charging dock `(0, 0)` scaled in millimeters or centimeters).

---

## 2. Room Selection / Partition Cleaning (`DP 101` on T3, `DP 102` on T2)

Used when directing the robot to clean specific rooms (named partitions in the map).

### Wire Layout (Type 1 - Modern T3 Multi-Room Struct)

| Offset | Size (bytes) | Type | Field | Description |
|---|---|---|---|---|
| `0x00` | 1 | `uint8` | `version` | Protocol version (`0x01` or `0x02`) |
| `0x01` | 1 | `uint8` | `clean_count` | Number of passes per room (1 = single pass, 2 = deep clean) |
| `0x02` | 1 | `uint8` | `room_count` | Number of rooms to follow ($N$) |
| `0x03` | $N$ | `uint8[]` | `room_ids` | Ordered list of Room IDs (1..32) |
| `0x03+N` | 1 | `uint8` | `checksum` | (Optional on some firmware) Simple 8-bit XOR checksum |

#### Example (Clean Room 2 and Room 4, 1 pass):
- Raw bytes: `01 01 02 02 04`
- Base64: `AQECAgQ=`

#### Python struct encoder/decoder:
```python
import struct
import base64

def encode_room_clean(room_ids: list[int], passes: int = 1) -> str:
    payload = struct.pack(f">BBB{len(room_ids)}B", 1, passes, len(room_ids), *room_ids)
    return base64.b64encode(payload).decode("ascii")

def decode_room_clean(b64_str: str) -> dict:
    data = base64.b64decode(b64_str)
    version, passes, count = struct.unpack(">BBB", data[:3])
    room_ids = list(data[3:3+count])
    return {"version": version, "passes": passes, "room_ids": room_ids}
```

---

## 3. Zone / Restricted Area Cleaning (`DP 102` on T3, `DP 103` on T2)

Instructs the vacuum to clean one or more bounding box rectangles defined in local coordinates.

### Coordinate System
- Point `(0, 0)` is the primary SLAM map origin (anchor typically established when docking).
- Resolution: $1 \text{ unit} = 10\text{ mm} = 1\text{ cm}$. Coordinates are signed 16-bit integers (`int16`, range -32768 to 32767) or unsigned centered at `0x7FFF`.

### Wire Layout
| Offset | Size | Type | Field | Description |
|---|---|---|---|---|
| `0x00` | 1 | `uint8` | `version` | Zone format version (`0x01`) |
| `0x01` | 1 | `uint8` | `zone_count` | Number of rectangular zones ($M$) |
| For each zone ($10$ bytes): | | | |
| `+0` | 2 | `int16_be` | `x1` | Top-Left X coordinate |
| `+2` | 2 | `int16_be` | `y1` | Top-Left Y coordinate |
| `+4` | 2 | `int16_be` | `x2` | Bottom-Right X coordinate |
| `+6` | 2 | `int16_be` | `y2` | Bottom-Right Y coordinate |
| `+8` | 1 | `uint8` | `clean_times` | Clean passes (1 or 2) |
| `+9` | 1 | `uint8` | `suction_override` | Suction mode override (0 = default) |

---

## 4. Go-To Target Point / Spot Clean (`DP 103` on T3, `DP 104` on T2)

Directs the robot to navigate to a target `(X, Y)` coordinate on the map.

### Wire Layout
| Offset | Size | Type | Field | Description |
|---|---|---|---|---|
| `0x00` | 1 | `uint8` | `version` | Protocol version (`0x01`) |
| `0x01` | 2 | `int16_be` | `x` | Target X coordinate (cm) |
| `0x03` | 2 | `int16_be` | `y` | Target Y coordinate (cm) |
| `0x05` | 1 | `uint8` | `mode` | `0x00` = Navigate only, `0x01` = Spot clean at target |

---

## 5. Map & SLAM Trajectory Stream (`DP 105`)

Lilin T2/T3 vacuums stream map tiles and real-time path updates via DP 105.

### Packet Frame Header
| Offset | Size | Type | Field | Description |
|---|---|---|---|---|
| `0x00` | 2 | `uint16_be` | `magic` | Header magic (`0xAA55` or `0x55AA`) |
| `0x02` | 2 | `uint16_be` | `frame_type` | `0x0001` = Map Metadata, `0x0002` = Grid Tile, `0x0003` = Robot Trajectory Path |
| `0x04` | 2 | `uint16_be` | `seq` | Frame sequence number |
| `0x06` | 2 | `uint16_be` | `length` | Body length $L$ in bytes |
| `0x08` | $L$ | `bytes` | `payload` | Frame payload (compressed LZ4 or raw bitmap/point list) |

#### Robot Trajectory Sub-Packet (`frame_type == 0x0003`):
Sequence of 16-bit signed coordinate pairs `(x, y)` representing the vacuum's traveled path.

---

## 6. Do Not Disturb (DND) Window (`DP 106`)

| Offset | Size | Type | Field | Description |
|---|---|---|---|---|
| `0x00` | 1 | `uint8` | `enabled` | `0x00` = Disabled, `0x01` = Enabled |
| `0x01` | 1 | `uint8` | `start_hour` | 0-23 |
| `0x02` | 1 | `uint8` | `start_minute` | 0-59 |
| `0x03` | 1 | `uint8` | `end_hour` | 0-23 |
| `0x04` | 1 | `uint8` | `end_minute` | 0-59 |
