# Liectroux XR500 Hardware & Firmware Architecture Notes

**Device:** Liectroux XR500 Robot Vacuum Cleaner  
**OEM Manufacturer:** Xiamen Lilin Electronics Co., Ltd.  
**Mainboard Revisions:** T2 (Legacy, ~2019-2020) and T3 (Modern, ~2021+)

---

## 1. Mainboard & System-on-Chip (SoC) Overview

Disassembly of the XR500 reveals a multi-processor split-architecture:
1. **Application Processor (AP / Linux System):**
   - **SoC Options:**
     - **T2 Revisions:** Allwinner R16 / V3s (Quad-core ARM Cortex-A7 @ 1.2 GHz) or Rockchip RV1108.
     - **T3 Revisions:** Rockchip RK3308 / Ingenic T31 (Quad-core Cortex-A35) running embedded Linux with hardware DSP for LDS (Laser Distance Sensor) SLAM computation.
   - **Flash Memory:** 
     - 128 MB / 256 MB SPI NAND Flash (Winbond W25N01GV or ESMT) or 32 MB SPI NOR (`W25Q256JV`).
   - **RAM:** 64 MB - 128 MB DDR3 integrated / PoP.
2. **Microcontroller (MCU - Real-Time Motor & Sensor Subsystem):**
   - **MCU:** STMicroelectronics STM32F103 / GD32F303 or Nuvoton NUC126 (ARM Cortex-M0/M3).
   - Responsible for real-time wheel PWM, cliff infrared sensors, optical bumper switches, IMU (gyroscope/accelerometer), and battery fuel gauge.
   - Communicates with the Linux AP over an internal high-speed UART (`/dev/ttyS1` or `/dev/ttyS2` at 115200 or 460800 baud).
3. **Wi-Fi Subsystem:**
   - Realtek **RTL8189FTV** (SDIO 802.11b/g/n) or Tuya **TYWE1S** / **CBU** embedded module linked to Linux host.

---

## 2. Internal Micro-USB Port Enumeration

Under the top decorative lid / bumper rubber gasket, a female Micro-USB connector is located directly adjacent to the mainboard edge.

### Operating Modes

#### A. Running Linux Kernel (Normal Boot)
When plugged into a Linux PC while the vacuum is powered on:
```bash
lsusb
# ID 18d1:4ee7 Google Inc. Nexus/Pixel Device (ADB Mode) 
# OR
# ID 0525:a4a7 Nuvoton / Linux USB Ethernet / CDC Serial Gadget
```
- If ADB is enabled in vendor build:
  ```bash
  adb devices
  adb shell
  ```
- If CDC-ACM Serial Gadget is exposed:
  Provides a root tty console at `/dev/ttyACM0`.

#### B. Hardware Recovery / BootROM Mode
When the vacuum is held with `Power + Home` pressed while connecting USB, or if the boot flash is empty:
- Allwinner SoC: `ID 1f3a:efe8 Onda (unverified) Allwinner Technology FEL mode`
  - Flashable using `sunxi-fel`.
- Rockchip SoC: `ID 2207:330c Fuzhou Rockchip Electronics Maskrom / Loader mode`
  - Accessible via `rkdeveloptool` or `upgrade_tool`.

---

## 3. 3.3V UART Serial Console

On the mainboard silkscreen (typically near the SoC / Wi-Fi module), a 4-pin 2.0mm unpopulated header or test pads are labeled:
```
[VCC (3.3V)]  [TX]  [RX]  [GND]
```
> [!CAUTION]
> Never connect the `VCC` pin to your USB-to-UART adapter. Connect only **TX**, **RX**, and **GND** using a **3.3V TTL level** adapter (e.g., FT232RL or CP2102).

### Connection Parameters
- **Baud Rate:** `115200`
- **Data Bits:** `8`
- **Parity:** `None`
- **Stop Bits:** `1`
- **Flow Control:** `None`

### Terminal Capture Command
```bash
picocom -b 115200 /dev/ttyUSB0 --logfile docs/uart_boot.log
```

### Typical Boot Log Sequence
```text
U-Boot 2018.07 (Lilin Robot Build)
DRAM:  128 MiB
NAND:  128 MiB
Loading Kernel Image ... OK
Starting kernel ...
[    0.000000] Linux version 4.9.118 (root@build-server) ...
[    1.240120] mtd: Creating 6 MTD partitions:
[    1.241030] 0x000000000000-0x000000100000 : "uboot"
[    1.242000] 0x000000100000-0x000000600000 : "kernel"
[    1.243000] 0x000000600000-0x000002600000 : "rootfs" (SquashFS)
[    1.244000] 0x000002600000-0x000004000000 : "app" (SquashFS / Read-Only)
[    1.245000] 0x000004000000-0x000008000000 : "userdata" (UBIFS / JFFS2 read-write)
```

---

## 4. Vendor Firmware Package (`code.pack`) Structure

Firmware updates or vendor recovery files for Lilin/Liectroux vacuums are typically bundled as `code.pack` or `update.img`.

### Unpacking & Analysis Workflow

1. Inspect file signatures:
   ```bash
   file firmware/code.pack
   binwalk -B firmware/code.pack
   ```
2. Extract embedded partitions:
   ```bash
   binwalk -e firmware/code.pack -C firmware/extracted/
   ```
3. Extracted components:
   - `rootfs.squashfs`: Linux OS filesystem, system init scripts (`/etc/init.d/rcS`).
   - `app.squashfs`:
     - `/app/bin/robot_slam`: Laser SLAM navigation, wall-following algorithms, path planning.
     - `/app/bin/tuya_daemon`: Tuya IoT SDK client handling UDP discovery (port 6666/6667), local TCP protocol (port 6668), and MQTT cloud telemetry.
     - `/app/bin/mcu_comm`: Serial driver relaying commands to the motor/sensor MCU.
   - IPC Architecture: `robot_slam` communicates with `tuya_daemon` via local UNIX domain sockets (`/tmp/robot_ipc.sock`) or FIFO pipes.
