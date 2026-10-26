# CAN-7USAT Ground Station — Official User Manual & Technical Operator's Guide
**Document No.:** GS-MAN-2026-038  
**Mission:** IN-SPACe CAN-7USAT India Student Competition 2026 (3rd Edition)  
**Team ID:** 038 (`2026-IN-SPACe-CAN-7USAT-038`)  
**Software Version:** 1.0.0 (Electron Desktop App)  

---

## 1. System Overview & Architecture

### 1.1 Purpose
The CAN-7USAT Ground Station is a mission-critical desktop application engineered to monitor, display, record, and command the Team 038 CanSat during pre-launch testing, launch pad countdown, rocket ascent (~1000m AGL), rocket deployment, dual-stage parachute descent, and post-touchdown recovery.

### 1.2 Technology Stack
* **Framework:** Electron 45.0.0 (Chromium + Node.js 22 runtime).
* **Process Architecture:** 
  * **Main Process (`src/main/main.js`):** Node.js environment managing IPC routing, high-resolution simulation clock scheduling, file I/O, serial radio transport via `serialport`, and data logging.
  * **Renderer Process (`src/renderer/app.js`, `index.html`, `styles/main.css`):** Hardware-accelerated UI rendering using Canvas/Chart.js 4.4 and Leaflet 1.9.4.
* **Telemetry Engine:** ASCII comma-separated parser (`src/telemetry/parser.js`) strictly conforming to IN-SPACe Competition Guidelines §6.3.
* **Simulation Core:** Physics-based ISA atmospheric flight simulator (`src/simulation/physics.js`) providing deterministic time-correlated trajectory data without radio transmission.

### 1.3 System Component Architecture

```
  +-------------------------------------------------------------------------------+
  |                              ELECTRON MAIN PROCESS                            |
  |                                                                               |
  |  +--------------------+        +--------------------+                         |
  |  |  SimulationEngine  |        |  SerialInterface   | <-- USB Radio Adapter   |
  |  |   (physics.js)     |        | (serialInterface)  |     (Teensy / SX1262)   |
  |  +---------+----------+        +---------+----------+                         |
  |            |                             |                                    |
  |      [Sim Packet]                   [Raw String]                              |
  |            |                             |                                    |
  |            |                    +--------v----------+                         |
  |            |                    |  TelemetryParser  |                         |
  |            |                    |    (parser.js)    |                         |
  |            |                    +--------+----------+                         |
  |            |                             |                                    |
  |            +--------------+--------------+                                    |
  |                           |                                                   |
  |            +--------------v--------------+                                    |
  |            |   IPC Broker (main.js)      |                                    |
  |            +---+----------+----------+---+                                    |
  |                |          |          |                                        |
  |     +----------v---+  +---v------+  +v--------------------+                   |
  |     |  DataLogger  |  |EventLog  |  |  CommandProcessor   |                   |
  |     | (Flight.csv) |  |(events)  |  | (Safety & Dispatch) |                   |
  |     +--------------+  +----------+  +---------------------+                   |
  +---------------------------|---------------------------------------------------+
                              | IPC: 'telemetry-packet', 'event', 'sim-status'
  +---------------------------v---------------------------------------------------+
  |                             RENDERER PROCESS (UI)                             |
  |                                                                               |
  |   +-------------------+  +-------------------+  +-------------------+         |
  |   | Mission Dashboard |  |  Real-Time Table  |  | Chart.js (Plots)  |         |
  |   | 16 Telemetry Cards|  |   (telemetry.js)  |  | 10 Dynamic Tracks |         |
  |   +-------------------+  +-------------------+  +-------------------+         |
  |   +-------------------+  +-------------------+  +-------------------+         |
  |   | Leaflet Map (GPS) |  |  Command Console  |  | Diagnostics & Radio|        |
  |   +-------------------+  +-------------------+  +-------------------+         |
  +-------------------------------------------------------------------------------+
```

---

## 2. Telemetry Packet Structure (§6.3)

Telemetry is transmitted as comma-separated ASCII values terminated by a carriage return (`\r` or `\r\n`) at a rate of 1 Hz or faster.

### 2.1 Field Specification Table

| Index | Field Name | Type | Unit | Precision | Example | Description |
|:---:|:---|:---:|:---:|:---:|:---|:---|
| 0 | `TEAM_ID` | String | - | Exact | `2026-IN-SPACe-CAN-7USAT-038` | Official registered team identifier |
| 1 | `TIME_STAMPING` | Float | s | 0.1 s | `42.5` | Mission Elapsed Time (MET) from power-on |
| 2 | `PACKET_COUNT` | Integer | - | 1 | `43` | Monotonically increasing sequence number |
| 3 | `ALTITUDE` | Float | m | 0.1 m | `854.2` | Barometric altitude relative to ground reference |
| 4 | `PRESSURE` | Integer | Pa | 1 Pa | `91520` | Measured atmospheric pressure |
| 5 | `TEMP` | Float | °C | 0.1 °C | `22.4` | Ambient temperature |
| 6 | `VOLTAGE` | Float | V | 0.01 V | `8.24` | 2S Li-Ion power bus voltage (nominal 7.4V–8.4V) |
| 7 | `GNSS_TIME` | String | UTC | 1 s | `12:45:02` | GNSS/NavIC receiver time |
| 8 | `GNSS_LATITUDE` | Float | ° | 0.0001° | `26.7412` | Latitude (WGS-84 / NavIC) |
| 9 | `GNSS_LONGITUDE` | Float | ° | 0.0001° | `83.8894` | Longitude (WGS-84 / NavIC) |
| 10 | `GNSS_ALTITUDE` | Float | m | 0.1 m | `934.2` | Height above mean sea level (ASL) |
| 11 | `GNSS_SATS` | Integer | - | 1 | `10` | Locked satellites (NavIC/GPS) |
| 12 | `ACCELEROMETER_DATA` | String | m/s²;° | 0.01 | `0.02;-0.05;-9.81;1.2;-0.5;45.0` | `ax;ay;az;roll;pitch;yaw` encoded with semicolons |
| 13 | `GYRO_SPIN_RATE` | Float | °/s | 0.1 °/s | `2.4` | Spin rate about the cylinder's longitudinal axis |
| 14 | `FLIGHT_SOFTWARE_STATE`| Integer | - | Enum (0–7)| `5` | Flight state index (see Section 2.2) |
| 15 | `OPTIONAL_DATA` | String | - | Free | `PAYLOAD_OK` | Optional experimental sensor payload telemetry |

### 2.2 Flight Software States (§6.2)
* **0 (BOOT):** Initial microcontroller power-up, hardware self-test, flash initialization.
* **1 (TEST_MODE):** Ground functional testing and calibration verification.
* **2 (LAUNCH_PAD):** Stationary in rocket payload bay awaiting launch; sensors zeroed.
* **3 (ASCENT):** High positive vertical acceleration under rocket propulsion to ~1000m apogee.
* **4 (ROCKET_DEPLOY):** Rocket fairing separation, ejection spring release, primary parachute deployment.
* **5 (DESCENT):** Stabilized primary parachute descent at ~20 m/s (±5 m/s).
* **6 (AEROBREAK_RELEASE):** Triggered at 600m (±10m); secondary mechanism slows descent to 1–3 m/s.
* **7 (IMPACT):** Touchdown detected (zero velocity, ground impact shock); audio beacon active.

---

## 3. The "Start Simulation" Button & Simulation Architecture

### 3.1 What Simulation Actually Is
The simulation is a **pure software digital twin** of the CanSat mission. It is **not mandatory** for launching or using the ground station—it is a pre-flight testbench that allows operators to train and verify software behavior without needing live radio signals or launch hardware.

### 3.2 What Happens Internally When You Click "Start Simulation"
1. **Reset & State Init:** The simulation state resets (`missionTime = 0`, `packetCount = 0`, `state = BOOT`).
2. **Clock Loop:** Electron's main process starts a high-resolution interval timer (`Math.floor(1000 / sampleRateHz)` ms).
3. **Euler Physics Integration:**
   * Altitude integrates based on ascent rate (40 m/s) and dual-stage descent aerodynamics (drag equations).
   * Barometric pressure derives dynamically from altitude using the **International Standard Atmosphere (ISA)** model:
     $$P = P_0 \left(1 - \frac{L \cdot h}{T_0}\right)^{\frac{g M}{R L}}$$
   * Temperature drops at the standard lapse rate ($0.0065 \text{ K/m}$).
   * Accelerometers report gravity ($1g = 9.81 \text{ m/s}^2$) plus trajectory acceleration and aerodynamic buffeting.
   * Battery voltage slowly drops based on load current ($0.001 \text{ V/s}$).
   * GNSS drift incorporates wind drift and pseudorange noise.
4. **Data Dispatch:** Packets are converted into telemetry objects and dispatched via IPC (`telemetry-packet`). If the **Data Logger** is active, they are simultaneously written to the flight CSV.
5. **UI Rendering:** The telemetry cards, real-time tables, charts, and Leaflet tracking map update immediately.

### 3.3 Simulation vs. Real Hardware Telemetry: How to Distinguish

| Indicator | Simulation Mode | Real / Live Hardware Mode |
|:---|:---|:---|
| **Top Status Badge** | Blue badge: `SIMULATION` | Green badge: `LIVE` |
| **Connection Badge** | `DISCONNECTED` (unless radio connected) | Green: `CONNECTED` |
| **Telemetry Cards** | Cyan sub-label: `SIM` + cyan border glow | Blue/white sub-label: `LIVE` |
| **Card Status Line** | Displays `SIMULATED` | Displays `LIVE DATA` |
| **CSV Output Header** | Contains warning: `# WARNING: SIMULATED data` | Indicates `# Source: LIVE` |
| **RF Radiation** | **Zero RF emitted**; radio TX disabled | Radio TX/RX active via USB COM port |

### 3.4 Simulation Controls Explained
* **▶ Start Simulation:** Resets physics and starts the mission clock from T+0.0s.
* **⏸ Pause:** Freezes physics calculations and stops packet generation without losing history.
* **▶ Resume:** Unpauses physics calculations from the exact point of interruption.
* **⏹ Stop:** Halts physics loop completely.
* **⟲ Reset:** Halts simulation, clears chart buffers, resets table rows, and clears GPS path.
* **Speed Slider (0.1x to 10x):** Accelerates or decelerates the simulation clock. Useful for validating a 15-minute flight in 90 seconds.

---

## 4. Screen-by-Screen User Interface Walkthrough

### 4.1 Top Header & Persistent Status Bar
* **Logo & Team Badge:** Displays `◆ CAN-7USAT` and `TEAM 038`.
* **Mode Badge (`#sb-mode`):** Indicates `SIMULATION` or `LIVE`.
* **Link Badge (`#sb-connection`):** Displays `DISCONNECTED`, `CONNECTING`, `CONNECTED`, or `CONNECTION_LOST`.
* **State Badge (`#sb-state`):** Shows the current flight state with color coding:
  * Gray = `BOOT`, Cyan = `TEST_MODE`, Blue = `LAUNCH_PAD`, Orange = `ASCENT`,
  * Yellow = `ROCKET_DEPLOY`, Green = `DESCENT`, Purple = `AEROBREAK_RELEASE`, Red = `IMPACT`.
* **Mission Clock (`#sb-met`):** Mission Elapsed Time formatted as `T+ XX.X s`.
* **Data Rate (`#sb-packet-rate`):** Incoming packet frequency (e.g. `1 pkt/s`).
* **Packet Count (`#sb-packets`):** Cumulative valid packets received.
* **Recording Indicator (`#sb-recording`):** Gray `NOT RECORDING` or flashing red `⏺ RECORDING`.
* **System Clock (`#sb-time`):** Local ground station PC time.

---

### 4.2 Sidebar Navigation Tabs

#### Tab 1: Dashboard (`#page-dashboard`)
* **Quick Controls:** Inline buttons for Quick Start, Quick Pause/Resume, and Quick Reset.
* **Flight State Banner:** Highlights current phase, elapsed phase duration, and data source.
* **16 Telemetry Cards:**
  1. *Relative Altitude:* Barometric altitude relative to ground level (m).
  2. *GNSS Altitude:* Altitude above sea level (m ASL).
  3. *Vertical Velocity:* Derived vertical descent/ascent rate (m/s).
  4. *Atmospheric Pressure:* Ambient pressure (Pa).
  5. *Temperature:* Sensor reading (°C).
  6. *Battery Voltage:* Power rail voltage (turns yellow below 7.0V, red below 6.5V).
  7. *GNSS Latitude & Longitude:* WGS84 coordinates in decimal degrees (0.0001° resolution).
  8. *GNSS Satellites:* Satellites locked (turns red below 3, yellow below 5).
  9. *Orientation (RPY):* Euler angles: Roll, Pitch, and Yaw in degrees.
  10. *Acceleration (X, Y, Z):* Tri-axial accelerations in m/s².
  11. *Gyro Spin Rate:* Rotational velocity about cylinder Z-axis (°/s).
  12. *Total Packets:* Sequence counter.
  13. *Mission Elapsed Time (MET):* Telemetry timestamp in seconds.
  14. *Packet Rate:* Incoming packet frequency.
  15. *Data Link:* Data authenticity indicator (`SIMULATED` vs `LIVE`).
* **Mini Event Feed:** Shows the 20 most recent critical mission events.

#### Tab 2: Telemetry Table (`#page-telemetry`)
* Tabular log of incoming packets showing all 16 fields.
* New packets appear at the top.
* Bounded buffer: stores the latest 500 rows to ensure UI rendering stays smooth and responsive.

#### Tab 3: Charts (`#page-charts`)
* **Time-series strip charts:**
  * Relative Altitude vs. GNSS Altitude
  * Vertical Velocity
  * Barometric Pressure
  * Temperature
  * Battery Voltage
  * Gyro Spin Rate
  * Satellite Count
  * Tri-axial Acceleration (X, Y, Z)
  * Orientation (Roll, Pitch, Yaw)
* **Chart Controls:**
  * *Window Select Dropdown:* Adjust view window (60s, 120s, 300s, 600s, or All).
  * *Pause Charts Button:* Freezes chart scrolling for manual curve inspection.
  * *Clear Charts Button:* Resets chart memory buffers.

#### Tab 4: Map (`#page-map`)
* Interactive 2D Leaflet map displaying:
  * Blue marker: Ground Station reference location.
  * Green marker: CanSat initial launch/power-on point.
  * Red marker: Live CanSat location.
  * Cyan polyline: Full flight ground track trajectory.
* Offline support: Uses local Leaflet assets; gracefully displays coordinate fallback if internet tiles are inaccessible in the field.

#### Tab 5: Command Console (`#page-commands`)
* Structured button grid for competition telecommands (§6.1):
  * **Start Telemetry:** Signals CanSat to begin active RF transmission.
  * **Stop Telemetry:** Halts CanSat RF transmission.
  * **Calibrate Gyro:** Zeroes gyroscope bias while sitting stationary on launch pad.
  * **Zero Baro Altitude:** Captures ground pressure baseline as zero reference.
  * **Calibrate Accelerometer:** Sets launch-pad gravitational vector baseline.
  * **Request Status & Config:** Polls flight software health and parameters.
  * **Simulation Fault Injection:** (Sim-only) Allows manual injection of sensor dropouts, baro failures, or microcontroller watchdog resets to test recovery logic.
* **Audit Trail:** Every command logs its dispatch time, arguments, and acknowledgement status (`ACKNOWLEDGED`, `PENDING`, or `REJECTED`).

#### Tab 6: Radio Configuration (`#page-radio`)
* Hardware serial connection panel:
  * Port Selector (`COM1`, `COM3`, `/dev/ttyUSB0`).
  * Baud Rate (Default: 115200).
  * Connect / Disconnect buttons.
* SX1262 LoRa configuration display (matches Team 038 parameters):
  * Primary Freq: 865.50 MHz | Backup Freq: 867.25 MHz | Bandwidth: 125 kHz
  * Spreading Factor: SF7 | Coding Rate: 4/5 | Sync Word: 0xA4 | Power: +10 dBm | Preamble: 8

#### Tab 7: Data Logger (`#page-logger`)
* File controls:
  * **Start Recording:** Opens write stream to `data/Flight_038_<TIMESTAMP>.csv`.
  * **Stop Recording:** Flushes and cleanly closes the CSV write stream.
  * **Select Output Directory:** Customizes destination folder (e.g. external USB flash drive).
* History list: Lists past recordings with file sizes and modification timestamps.

#### Tab 8: Event Log (`#page-events`)
* Filterable mission timeline logging:
  * Severity filters: `ALL`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`.
  * Type filters: `STATE_TRANSITION`, `DEPLOY`, `AEROBREAK`, `LANDING`, `FAULT`, `COMMAND`.

#### Tab 9: Simulation Scenarios (`#page-simulation`)
* Pre-programmed test scenarios:
  1. **Nominal Flight:** Standard 1000m apogee, deployment, 600m aerobreak, gentle touchdown.
  2. **High Wind / Drift:** Enhanced lateral drift to test GPS tracking range.
  3. **Early Ejection:** Premature rocket separation at 850m.
  4. **Sensor Fault & Reset:** Injects in-flight processor reset to verify state persistence.
  5. **Fast Descent:** Simulates primary parachute tear (~25 m/s descent).
* Parametric adjustments: Launch altitude, aerobreak altitude, descent rates, sample rate, noise seeds.

#### Tab 10: Settings & Diagnostics (`#page-settings`)
* Team configuration overrides.
* Real-time process diagnostics: Electron memory usage, Node runtime version, parser error statistics (valid packets, sequence gaps, duplicates).

---

## 5. Telemetry Data Flow Traces

### Case A: Simulated Telemetry Generation
1. `SimulationEngine.step()` computes kinematic updates.
2. Formats packet object containing all 16 fields plus boolean `isSimulated: true`.
3. Dispatched over Electron IPC `mainWindow.webContents.send('telemetry-packet', packet)`.
4. If `dataLogger.recording === true`, appended directly to `Flight_038.csv`.
5. In renderer, `updateDashboard()`, `updateCharts()`, and `updateMap()` consume the packet simultaneously.

### Case B: Live Hardware Telemetry Packet Arrival
1. Ground receiver MCU (e.g. Teensy 4.1 connected via USB) receives SX1262 LoRa packet over the air.
2. Receiver prints ASCII CSV line terminated by `\r\n` to USB Serial CDC port.
3. Node.js `serialport` module in `SerialInterface` catches the `data` event.
4. Line buffer splits on delimiters and forwards raw string to `TelemetryParser.feed()`.
5. `TelemetryParser.parseLine()` performs:
   * Field count check (at least 15 required).
   * Team ID match check (`2026-IN-SPACe-CAN-7USAT-038`).
   * Sequence check: compares `PACKET_COUNT` against `lastPacketCount` to flag sequence gaps or duplicate transmissions.
   * Coordinate and voltage bounds checking.
   * Accelerometer data string parsing (`ax;ay;az;roll;pitch;yaw`).
6. Valid packet marked with `isSimulated: false` and `source: 'LIVE'`.
7. Packet dispatched via IPC to UI and Data Logger.

### Case C: Malformed or Incomplete Packet
1. Damaged packet arrives (e.g. RF collision: `2026-IN-SPACe-CAN-7USAT-038,12.5,14,350.2,98... [CORRUPTED]`).
2. `TelemetryParser.parseLine()` detects fewer than 15 fields or NaN values.
3. Packet is **safely dropped**; does not pollute charts or trigger invalid state jumps.
4. `TelemetryParser.invalidPackets` counter increments.
5. Error logged to parser diagnostics buffer with raw string slice.
6. The UI status bar and dashboard maintain the last known good valid values.

---

## 6. Command Execution & Safety Protocol

The competition mandates that commands can be issued to calibrate sensors and control telemetry transmission prior to launch (§6.1).

### 6.1 Command Reference Table

| Command ID | Display Label | Parameters | Precondition | Safety Confirmation | Real Hardware Impact |
|:---|:---|:---|:---|:---:|:---|
| `START_TELEMETRY` | Start Telemetry | None | CanSat in rocket bay | No | CanSat begins active RF transmission |
| `STOP_TELEMETRY` | Stop Telemetry | None | Pre-launch or recovery | No | CanSat turns off transmitter |
| `CALIBRATE_GYRO` | Calibrate Gyro | None | Stationary on launch pad | No | Zeroes angular rate offsets in firmware |
| `ZERO_BAROMETRIC_ALTITUDE` | Zero Altitude | None | Stationary on launch pad | No | Firmware locks ground pressure reference |
| `CALIBRATE_ACCELEROMETER`| Calibrate Accel | None | Stationary on launch pad | No | Zeroes lateral accelerometers ($1g$ on Z) |
| `REQUEST_STATUS` | Request Status | None | Any | No | Returns battery voltage, state, error flags |
| `REQUEST_CONFIGURATION` | Request Config | None | Any | No | Returns active firmware timings and gains |
| `RESET_SIMULATION` | Reset Simulation| None | Simulation Mode Only | No | Re-initializes software physics model |
| `INJECT_TEST_FAULT` | Inject Fault | `faultType` | Simulation Mode Only | **Yes (Confirm Dialog)** | Simulates sensor crash or MCU reset |

### 6.2 Safety Interlocks
* **Simulation Guard:** Simulation-only commands (`RESET_SIMULATION`, `INJECT_TEST_FAULT`) are rejected if the application is connected in `LIVE` mode.
* **No Unsolicited RF:** The application **never** transmits live radio commands automatically.
* **Explicit Transport Acknowledgement:** If the radio transport is unconfigured or disconnected, commands are designated as `PENDING: Live radio transport not configured` rather than falsely reporting success.

---

## 7. CSV Data Logging & Mission Records

### 7.1 Competition Compliance (§6.3)
Competition judges require the complete flight log submitted on a USB flash drive immediately following recovery. The file must match the format `Flight_<TEAM_ID>.csv`.

### 7.2 File Naming & Preservation
To prevent accidentally overwriting previous flight trials during testing, the logger creates timestamped files:
```text
f:\vs\GS\data\Flight_038_2026-10-26T05-48-26.csv
```
* **Official Export:** You can rename the definitive flight file to `Flight_038.csv` before handing it to competition judges.
* **Header Structure:**
  ```csv
  # CAN-7USAT Ground Station Telemetry Log
  # Team: 038
  # Source: LIVE
  # Started: 2026-10-26T05:48:26.123Z
  # Format: Competition Document §6.3 field order
  #
  TEAM_ID,TIME_STAMPING,PACKET_COUNT,ALTITUDE,PRESSURE,TEMP,VOLTAGE,GNSS_TIME,GNSS_LATITUDE,GNSS_LONGITUDE,GNSS_ALTITUDE,GNSS_SATS,ACCELEROMETER_DATA,GYRO_SPIN_RATE,FLIGHT_SOFTWARE_STATE,OPTIONAL_DATA
  ```
* **Crash Resilience:** Telemetry rows write directly to Node.js filesystem write streams without caching entire flights in RAM, ensuring data is saved even during sudden power loss.

---

## 8. Hardware Setup: Connecting the Real Radio

### 8.1 Ground Hardware Architecture
To receive genuine telemetry over the air:
1. **CanSat Transmitter:** Teensy 4.1 connected via SPI to SX1262 LoRa module.
2. **Ground Receiver Station:** A matching SX1262 LoRa module connected via SPI to a ground microcontroller (Teensy, ESP32, or STM32).
3. **USB Link:** The ground microcontroller connects to the Ground Station laptop via USB.

### 8.2 Radio Configuration Parameters
Both on-board and ground radios must share identical settings:
* **Frequency:** 865.50 MHz (Primary) / 867.25 MHz (Backup)
* **Bandwidth:** 125 kHz
* **Spreading Factor:** 7
* **Coding Rate:** 4/5
* **Sync Word:** `0xA4`
* **Preamble:** 8 symbols

### 8.3 Ground Receiver Firmware Requirement
The ground receiver microcontroller simply acts as a transparent serial bridge:
```cpp
// Sample Teensy 4.1 Ground Receiver snippet
void loop() {
  if (LoRa.parsePacket()) {
    while (LoRa.available()) {
      Serial.write((char)LoRa.read());
    }
  }
}
```
Whenever the receiver receives a packet over RF, it prints it out to `Serial` followed by `\r\n`. The Ground Station software listens to that serial port, parses the fields, and plots the mission live.

---

## 9. Troubleshooting Guide

| Issue | Likely Cause | Diagnostic Step | Remedial Action |
|:---|:---|:---|:---|
| **App fails to start** | Node/Electron version conflict or missing packages | Run `npm test` in terminal | Ensure Node 20+ installed; run `npm install` |
| **Simulation button does nothing** | Previous simulation is finished or paused | Check `#sb-state` badge | Click **Reset** (`⟲ Reset`) on dashboard first |
| **Telemetry cards are frozen** | Simulation paused or serial port stopped sending | Inspect `pkt/s` in top header | Click **Resume** or check serial cable connection |
| **Graphs do not update** | "Pause Charts" button was toggled active | Check Pause Charts button text | Click **Resume Charts** on Charts tab |
| **No COM ports visible in dropdown** | Missing USB-to-UART drivers (CP210x, CH340, FTDI) | Open Windows Device Manager | Install appropriate VCP driver and click **Refresh Ports** |
| **Serial connects but no packets appear** | Baud rate mismatch or ground radio not synced | Inspect receiver RX LED | Verify baud rate is 115200; verify sync word `0xA4` |
| **Packets increment "Invalid Packets"** | Mismatched team ID or missing delimiter | Check Settings tab parser stats | Verify CanSat firmware sends `2026-IN-SPACe-CAN-7USAT-038` and 15 commas |
| **CSV log file is missing** | Logger was not manually started | Check top `#sb-recording` badge | Click **Start Recording** on Logger tab before launch |
| **Map shows no satellite coordinates** | GNSS receiver has no sky fix ($0, 0$) | Check GNSS Satellites card | Take CanSat outdoors; wait for satellite lock (>4 sats) |

---

## 10. Pre-Flight Checklist for Mission Day

- [ ] **1. Laptop Power:** Laptop plugged into AC power or 100% battery with 2+ hours runtime (§6.1.xi).
- [ ] **2. Antenna Placement:** Ground station antenna mounted on tripod, elevated, clear line-of-sight to launch pad (§6.1.iii, §6.1.xi).
- [ ] **3. USB Connection:** Ground receiver plugged in and identified in Windows Device Manager.
- [ ] **4. Launch Application:** Start app with `npm start`.
- [ ] **5. Radio Link Check:** Select COM port in **Radio** tab, click **Connect Serial**. Confirm status changes to `LIVE`.
- [ ] **6. Start CSV Logging:** Navigate to **Logger** tab, confirm path, click **Start Recording**. Confirm red `⏺ RECORDING` badge.
- [ ] **7. Zero Altitude:** As CanSat sits on launch pad, click **Zero Barometric Altitude** in Commands tab. Confirm relative altitude reads $0.0 \text{ m}$ (±0.5m).
- [ ] **8. Calibrate Gyro:** Click **Calibrate Gyro** in Commands tab. Confirm gyro rate reads $0.0 \text{ °/s}$.
- [ ] **9. Verify GNSS:** Confirm satellite count $\ge 6$ and coordinates match the launch site (Kushinagar area ~26.74°N, 83.89°E).
- [ ] **10. Enable Telemetry:** Send **Start Telemetry** telecommand prior to rocket liftoff (§6.1.ii).
- [ ] **11. Post-Flight Touchdown:** After landing detected, allow 15 seconds of stationary logging, then click **Stop Recording**.
- [ ] **12. Judge Export:** Copy `data/Flight_038.csv` to competition-provided USB drive (§6.3.ii).
