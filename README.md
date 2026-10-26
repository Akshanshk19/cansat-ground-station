# CAN-7USAT Ground Station — Quick Start Guide
**Team ID:** 038 | **IN-SPACe CAN-7USAT Competition 2026**

This quick reference guide will get you running a test flight simulation or connecting live hardware in under 2 minutes.

---

## 1. Launch the Application
Open a terminal in `f:\vs\GS` and run:
```powershell
npm start
```
The ground station window opens with the dark aerospace mission dashboard.

---

## 2. Run a 60-Second Test Flight Simulation
1. Click the **Logger** tab on the left sidebar.
2. Click **⏺ Start Recording** (Status bar top-right displays `⏺ RECORDING`).
3. Click the **Dashboard** tab.
4. Click the blue **▶ Start Simulation** button.
5. Watch the mission cycle through the 8 flight states:
   * `BOOT` $\rightarrow$ `TEST_MODE` $\rightarrow$ `LAUNCH_PAD` $\rightarrow$ `ASCENT` (to 1000m)
   * $\rightarrow$ `ROCKET_DEPLOY` $\rightarrow$ `DESCENT` (20 m/s) $\rightarrow$ `AEROBREAK_RELEASE` (at 600m, 2 m/s) $\rightarrow$ `IMPACT`
6. Switch to the **Charts** tab to observe live curves (Altitude, Velocity, Pressure, Orientation, Acceleration).
7. Switch to the **Map** tab to view the GPS flight track.
8. Once the CanSat lands (`IMPACT`), go back to the **Logger** tab and click **⏹ Stop Recording**.
9. Your flight CSV is ready in `f:\vs\GS\data\Flight_038_<timestamp>.csv`!

---

## 3. How to Connect Real Hardware (Radio Receiver)
1. Plug your USB ground receiver (Teensy 4.1 + SX1262 LoRa module) into the laptop.
2. Open the **Radio** tab on the left sidebar.
3. Select your receiver's COM port from the dropdown (e.g. `COM3`).
4. Keep baud rate set to `115200`.
5. Click **Connect Serial**.
6. The status badge will change from `SIMULATION` to **`LIVE`** (Green).
7. Live incoming radio telemetry will now update your dashboard, graphs, and CSV logs!

---

## 4. Pre-Launch Launch-Pad Procedure
Before the rocket launches:
1. In the **Logger** tab: Click **Start Recording**.
2. In the **Commands** tab:
   * Click **Zero Barometric Altitude** (sets ground reference to 0.0m).
   * Click **Calibrate Gyro** (zeroes angular drift).
   * Click **Start Telemetry** (commands CanSat to begin RF transmission).
3. Confirm satellite lock ($\ge 6$ satellites) and clean incoming telemetry packets.
4. Stand by for rocket liftoff!
