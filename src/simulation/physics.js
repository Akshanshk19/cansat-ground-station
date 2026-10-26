/**
 * CAN-7USAT Ground Station - Physics Simulation Engine
 * 
 * Generates physically plausible, time-correlated telemetry data
 * for all mission phases. Uses ISA atmospheric model, realistic
 * sensor noise, and coherent state transitions.
 * 
 * SIMULATION ONLY - Does not represent actual flight conditions.
 * All parameters are configurable assumptions.
 */

'use strict';

// ─── Flight States (per competition document §6.2) ─────────────────────────
const FLIGHT_STATES = {
  BOOT: 0,
  TEST_MODE: 1,
  LAUNCH_PAD: 2,
  ASCENT: 3,
  ROCKET_DEPLOY: 4,
  DESCENT: 5,
  AEROBREAK_RELEASE: 6,
  IMPACT: 7
};

const STATE_LABELS = {
  0: 'BOOT',
  1: 'TEST_MODE',
  2: 'LAUNCH_PAD',
  3: 'ASCENT',
  4: 'ROCKET_DEPLOY',
  5: 'DESCENT',
  6: 'AEROBREAK_RELEASE',
  7: 'IMPACT'
};

// ─── ISA Atmospheric Model ─────────────────────────────────────────────────
const ISA = {
  P0: 101325,       // Sea-level pressure (Pa)
  T0: 288.15,       // Sea-level temperature (K)
  L: 0.0065,        // Temperature lapse rate (K/m)
  g: 9.80665,       // Gravitational acceleration (m/s²)
  M: 0.0289644,     // Molar mass of air (kg/mol)
  R: 8.31447        // Universal gas constant (J/(mol·K))
};

/**
 * Calculate atmospheric pressure at a given altitude using ISA model
 * @param {number} altitude - Altitude above sea level in meters
 * @param {number} groundAltitude - Ground station altitude ASL in meters
 * @returns {number} Pressure in Pascals
 */
function pressureAtAltitude(altitude, groundAltitude = 0) {
  const totalAlt = groundAltitude + altitude;
  const T = ISA.T0 - ISA.L * totalAlt;
  const exponent = (ISA.g * ISA.M) / (ISA.R * ISA.L);
  return ISA.P0 * Math.pow(T / ISA.T0, exponent);
}

/**
 * Calculate temperature at altitude using ISA lapse rate
 * @param {number} altitude - Altitude above ground in meters
 * @param {number} groundTemp - Ground temperature in °C
 * @returns {number} Temperature in °C
 */
function temperatureAtAltitude(altitude, groundTemp = 25.0) {
  return groundTemp - ISA.L * altitude;
}

// ─── Seeded PRNG (Mulberry32) ──────────────────────────────────────────────
class SeededRandom {
  constructor(seed = 42) {
    this._seed = seed;
    this._state = seed;
  }

  reset() {
    this._state = this._seed;
  }

  /** Returns a float in [0, 1) */
  next() {
    let t = this._state += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a float in [min, max) */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Gaussian noise using Box-Muller */
  gaussian(mean = 0, stddev = 1) {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stddev;
  }
}

// ─── Default Simulation Configuration ──────────────────────────────────────
const DEFAULT_CONFIG = {
  teamId: '038',
  teamIdFull: '2026-IN-SPACe-CAN-7USAT-038',
  launchAltitude: 1000,           // meters AGL
  aerobreakAltitude: 600,         // meters AGL
  primaryDescentRate: 20,         // m/s (±5)
  secondaryDescentRate: 2,        // m/s (1-3 range)
  ascentRate: 40,                 // m/s (rocket ascent, assumption)
  ascentDuration: 25,             // seconds (assumption)
  payloadMass: 1.0,               // kg
  groundAltitudeASL: 80,          // meters ASL (configurable)
  groundTemp: 28.0,               // °C
  groundPressure: 101100,         // Pa (derived from altitude)
  batteryVoltageStart: 8.40,      // V (2S Li-Ion ~4.2V/cell)
  batteryVoltageEnd: 6.80,        // V
  batteryDrainRate: 0.001,        // V/s normal drain
  sampleRateHz: 1,                // Hz
  randomSeed: 42,
  // GNSS reference point (configurable, not a real launch site claim)
  gnssRefLat: 26.7412,            // Kushinagar approximate area
  gnssRefLon: 83.8894,
  gnssRefAlt: 80,                 // meters ASL
  // Noise standard deviations
  noise: {
    altitude: 0.3,      // meters
    pressure: 10,       // Pa
    temperature: 0.1,   // °C
    voltage: 0.005,     // V
    gnssLat: 0.00001,   // degrees (~1.1m)
    gnssLon: 0.00001,   // degrees
    gnssAlt: 1.5,       // meters
    accelX: 0.05,       // m/s²
    accelY: 0.05,       // m/s²
    accelZ: 0.1,        // m/s²
    roll: 0.5,          // degrees
    pitch: 0.5,         // degrees
    yaw: 1.0,           // degrees
    gyroSpin: 2.0       // deg/s
  },
  // Phase durations (configurable assumptions, not competition-mandated timings)
  phases: {
    bootDuration: 3,           // seconds
    testModeDuration: 5,       // seconds
    launchPadWait: 10,         // seconds  
    ascentDuration: 25,        // seconds to reach ~1000m
    rocketDeployDuration: 3,   // seconds for separation
    // descent durations computed from altitude/rate
  }
};

// ─── Simulation Scenarios ──────────────────────────────────────────────────
const SCENARIOS = {
  NOMINAL: {
    name: 'Nominal Flight',
    description: 'Standard mission profile: launch to 1000m, primary parachute descent at ~20 m/s, aerobreak at 600m, secondary descent at ~2 m/s.',
    overrides: {}
  },
  FAST_ASCENT: {
    name: 'Fast Ascent',
    description: 'Higher than normal ascent rate (~60 m/s).',
    overrides: { ascentRate: 60, ascentDuration: 17 }
  },
  SLOW_ASCENT: {
    name: 'Slow Ascent',
    description: 'Lower than normal ascent rate (~25 m/s).',
    overrides: { ascentRate: 25, ascentDuration: 40 }
  },
  LOW_BATTERY: {
    name: 'Low Battery',
    description: 'Battery starts low and drains faster, triggering low-voltage warnings.',
    overrides: { batteryVoltageStart: 7.20, batteryDrainRate: 0.004 }
  },
  GNSS_DEGRADATION: {
    name: 'GNSS Degradation',
    description: 'GNSS satellite count drops during descent, position accuracy degrades.',
    overrides: { _gnssDropout: true }
  },
  TELEMETRY_LOSS: {
    name: 'Intermittent Telemetry Loss',
    description: 'Simulates packet loss during mid-descent.',
    overrides: { _packetLoss: true, _packetLossRate: 0.3 }
  },
  BARO_FAILURE: {
    name: 'Barometric Sensor Failure',
    description: 'Barometric sensor fails mid-flight, reporting last known value.',
    overrides: { _baroFailure: true, _baroFailureTime: 45 }
  },
  RESET_RECOVERY: {
    name: 'Flight Computer Reset',
    description: 'Simulates processor reset mid-descent. Mission time and state must recover.',
    overrides: { _processorReset: true, _resetTime: 50 }
  },
  CUSTOM: {
    name: 'Custom Scenario',
    description: 'User-configured simulation parameters.',
    overrides: {}
  }
};

// ─── Simulation Engine ─────────────────────────────────────────────────────
class SimulationEngine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.config.noise = { ...DEFAULT_CONFIG.noise, ...(config.noise || {}) };
    this.config.phases = { ...DEFAULT_CONFIG.phases, ...(config.phases || {}) };
    this.rng = new SeededRandom(this.config.randomSeed);
    this.reset();
  }

  reset() {
    this.rng.reset();
    this.missionTime = 0;
    this.packetCount = 0;
    this.state = FLIGHT_STATES.BOOT;
    this.altitude = 0;
    this.verticalVelocity = 0;
    this.pressure = this.config.groundPressure || pressureAtAltitude(0, this.config.groundAltitudeASL);
    this.temperature = this.config.groundTemp;
    this.voltage = this.config.batteryVoltageStart;
    this.gnssLat = this.config.gnssRefLat;
    this.gnssLon = this.config.gnssRefLon;
    this.gnssAlt = this.config.gnssRefAlt;
    this.gnssSats = 8;
    this.accelX = 0;
    this.accelY = 0;
    this.accelZ = -ISA.g;
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.gyroSpinRate = 0;
    this.angularVelocity = 0;
    this.running = false;
    this.paused = false;
    this.telemetryEnabled = false;
    this.finished = false;
    this.scenarioOverrides = {};
    this.calibrationOffsets = { altitude: 0, accelX: 0, accelY: 0, accelZ: 0, gyro: 0 };
    this.stateStartTime = 0;
    this.resetOccurred = false;
    this.preResetState = null;
    this.preResetTime = 0;
    this.baroFailed = false;
    this.lastBaroValue = null;
    this.windDriftX = 0;
    this.windDriftY = 0;
    this.events = [];
    this._lastAltitude = 0;
  }

  setScenario(scenarioKey) {
    const scenario = SCENARIOS[scenarioKey];
    if (!scenario) return;
    this.scenarioOverrides = scenario.overrides || {};
    this.addEvent('SCENARIO', `Loaded scenario: ${scenario.name}`);
  }

  getConfig(key) {
    return this.scenarioOverrides[key] !== undefined 
      ? this.scenarioOverrides[key] 
      : this.config[key];
  }

  addEvent(type, message, severity = 'INFO') {
    this.events.push({
      time: this.missionTime,
      type,
      message,
      severity,
      timestamp: new Date().toISOString()
    });
  }

  // ─── Calibration Commands ──────────────────────────────────────────────
  calibrateGyro() {
    this.calibrationOffsets.gyro = -this.gyroSpinRate;
    this.addEvent('CALIBRATION', 'Gyro calibrated to zero');
    return { success: true, message: 'Gyro calibrated', offset: this.calibrationOffsets.gyro };
  }

  calibrateBarometricAltitude() {
    this.calibrationOffsets.altitude = -this.altitude;
    this.addEvent('CALIBRATION', 'Barometric altitude zeroed');
    return { success: true, message: 'Barometric altitude zeroed', offset: this.calibrationOffsets.altitude };
  }

  calibrateAccelerometer() {
    this.calibrationOffsets.accelX = -this.accelX;
    this.calibrationOffsets.accelY = -this.accelY;
    this.calibrationOffsets.accelZ = -(this.accelZ + ISA.g); // Zero out, leaving gravity
    this.addEvent('CALIBRATION', 'Accelerometer calibrated');
    return { success: true, message: 'Accelerometer calibrated' };
  }

  startTelemetry() {
    this.telemetryEnabled = true;
    this.addEvent('TELEMETRY', 'Telemetry transmission started');
    return { success: true, message: 'Telemetry enabled' };
  }

  stopTelemetry() {
    this.telemetryEnabled = false;
    this.addEvent('TELEMETRY', 'Telemetry transmission stopped');
    return { success: true, message: 'Telemetry disabled' };
  }

  injectFault(faultType) {
    switch (faultType) {
      case 'BARO_FAILURE':
        this.baroFailed = true;
        this.lastBaroValue = this.pressure;
        this.addEvent('FAULT', 'Barometric sensor failure injected', 'WARNING');
        return { success: true, message: 'Barometric sensor failure active' };
      case 'GNSS_DROPOUT':
        this.gnssSats = 0;
        this.addEvent('FAULT', 'GNSS dropout injected', 'WARNING');
        return { success: true, message: 'GNSS dropout active' };
      case 'PROCESSOR_RESET':
        this.resetOccurred = true;
        this.preResetState = this.state;
        this.preResetTime = this.missionTime;
        this.state = FLIGHT_STATES.BOOT;
        this.addEvent('FAULT', 'Processor reset injected', 'ERROR');
        return { success: true, message: 'Processor reset occurred' };
      default:
        return { success: false, message: `Unknown fault type: ${faultType}` };
    }
  }

  // ─── State Transition Logic ────────────────────────────────────────────
  _transitionState(newState) {
    const oldLabel = STATE_LABELS[this.state];
    const newLabel = STATE_LABELS[newState];
    this.state = newState;
    this.stateStartTime = this.missionTime;
    this.addEvent('STATE_TRANSITION', `${oldLabel} → ${newLabel}`);
  }

  // ─── Main Simulation Step ──────────────────────────────────────────────
  step(dt = null) {
    if (this.finished) return null;

    const sampleInterval = dt || (1.0 / this.config.sampleRateHz);
    this.missionTime += sampleInterval;
    this.packetCount++;

    const timeInState = this.missionTime - this.stateStartTime;
    const phases = this.config.phases;
    const noise = this.config.noise;

    // Handle processor reset recovery
    if (this.resetOccurred && this.state === FLIGHT_STATES.BOOT) {
      // After brief BOOT, recover to previous state (per competition req §6.2.ii)
      if (timeInState > 2) {
        this._transitionState(this.preResetState);
        this.addEvent('RECOVERY', `State recovered to ${STATE_LABELS[this.state]} after processor reset`, 'WARNING');
        this.resetOccurred = false;
      }
    }

    // Scenario-driven faults
    if (this.scenarioOverrides._processorReset && 
        this.missionTime >= this.scenarioOverrides._resetTime && 
        !this.resetOccurred && this.state >= FLIGHT_STATES.DESCENT) {
      this.injectFault('PROCESSOR_RESET');
    }
    if (this.scenarioOverrides._baroFailure && 
        this.missionTime >= this.scenarioOverrides._baroFailureTime && 
        !this.baroFailed) {
      this.injectFault('BARO_FAILURE');
    }

    // ─── Phase-based physics ───────────────────────────────────────────
    this._lastAltitude = this.altitude;

    switch (this.state) {
      case FLIGHT_STATES.BOOT:
        if (!this.resetOccurred && timeInState >= phases.bootDuration) {
          this._transitionState(FLIGHT_STATES.TEST_MODE);
        }
        this._updateGroundState();
        break;

      case FLIGHT_STATES.TEST_MODE:
        if (timeInState >= phases.testModeDuration) {
          this._transitionState(FLIGHT_STATES.LAUNCH_PAD);
        }
        this._updateGroundState();
        break;

      case FLIGHT_STATES.LAUNCH_PAD:
        if (timeInState >= phases.launchPadWait) {
          this._transitionState(FLIGHT_STATES.ASCENT);
        }
        this._updateGroundState();
        break;

      case FLIGHT_STATES.ASCENT:
        this._updateAscent(sampleInterval, timeInState);
        if (this.altitude >= this.getConfig('launchAltitude')) {
          this.altitude = this.getConfig('launchAltitude');
          this._transitionState(FLIGHT_STATES.ROCKET_DEPLOY);
        }
        break;

      case FLIGHT_STATES.ROCKET_DEPLOY:
        // Brief separation phase
        this.verticalVelocity *= 0.5; // Rapid deceleration during separation
        this.altitude += this.verticalVelocity * sampleInterval;
        this._updateOrientation(sampleInterval, 'deploy');
        if (timeInState >= phases.rocketDeployDuration) {
          this._transitionState(FLIGHT_STATES.DESCENT);
          this.addEvent('DEPLOY', 'Primary parachute deployed');
        }
        break;

      case FLIGHT_STATES.DESCENT:
        this._updateDescent(sampleInterval, 'primary');
        if (this.altitude <= this.getConfig('aerobreakAltitude')) {
          this._transitionState(FLIGHT_STATES.AEROBREAK_RELEASE);
          this.addEvent('AEROBREAK', `Aerobreak mechanism activated at ${this.altitude.toFixed(1)}m`);
        }
        break;

      case FLIGHT_STATES.AEROBREAK_RELEASE:
        this._updateDescent(sampleInterval, 'secondary');
        if (this.altitude <= 0) {
          this.altitude = 0;
          this.verticalVelocity = 0;
          this._transitionState(FLIGHT_STATES.IMPACT);
          this.addEvent('LANDING', `Landing detected at T+${this.missionTime.toFixed(1)}s`);
        }
        break;

      case FLIGHT_STATES.IMPACT:
        this._updateGroundState();
        this.verticalVelocity = 0;
        this.altitude = 0;
        if (timeInState > 10) {
          this.finished = true;
          this.addEvent('MISSION_COMPLETE', 'Mission simulation complete');
        }
        break;
    }

    // Update common sensors
    this._updatePressure();
    this._updateTemperature();
    this._updateBattery(sampleInterval);
    this._updateGNSS();

    // Compute vertical velocity from altitude change
    if (this.state !== FLIGHT_STATES.BOOT && this.state !== FLIGHT_STATES.TEST_MODE) {
      this.verticalVelocity = (this.altitude - this._lastAltitude) / sampleInterval;
    }

    // Packet loss simulation
    if (this.scenarioOverrides._packetLoss && 
        this.state >= FLIGHT_STATES.DESCENT &&
        this.rng.next() < (this.scenarioOverrides._packetLossRate || 0.2)) {
      return null; // Dropped packet
    }

    return this.buildTelemetryPacket();
  }

  // ─── Ground State (stationary) ─────────────────────────────────────────
  _updateGroundState() {
    this.altitude = 0 + this.rng.gaussian(0, 0.1);
    if (this.altitude < 0) this.altitude = 0;
    this.verticalVelocity = 0;
    this.accelX = this.rng.gaussian(0, this.config.noise.accelX);
    this.accelY = this.rng.gaussian(0, this.config.noise.accelY);
    this.accelZ = -ISA.g + this.rng.gaussian(0, this.config.noise.accelZ);
    this.roll = this.rng.gaussian(0, 0.2);
    this.pitch = this.rng.gaussian(0, 0.2);
    this.yaw += this.rng.gaussian(0, 0.05);
    this.gyroSpinRate = this.rng.gaussian(0, 1);
    this.angularVelocity = this.rng.gaussian(0, 0.5);
  }

  // ─── Ascent Phase ──────────────────────────────────────────────────────
  _updateAscent(dt, timeInState) {
    const ascentRate = this.getConfig('ascentRate');
    const maxAlt = this.getConfig('launchAltitude');
    
    // Smooth acceleration curve using sine profile
    const totalAscentTime = maxAlt / ascentRate;
    const fraction = Math.min(timeInState / totalAscentTime, 1);
    const instantRate = ascentRate * Math.sin(fraction * Math.PI / 2);
    
    this.altitude += instantRate * dt + this.rng.gaussian(0, this.config.noise.altitude * 0.5);
    this.altitude = Math.max(0, Math.min(this.altitude, maxAlt + 50));

    // High acceleration during ascent
    this.accelX = this.rng.gaussian(0, 0.5);
    this.accelY = this.rng.gaussian(0, 0.5);
    this.accelZ = -(ISA.g + instantRate * 0.3) + this.rng.gaussian(0, 0.3);

    this._updateOrientation(dt, 'ascent');
  }

  // ─── Descent Phase ────────────────────────────────────────────────────
  _updateDescent(dt, mode) {
    let targetRate;
    if (mode === 'primary') {
      // 20 m/s ± 5 m/s per competition requirement §5.4
      targetRate = this.getConfig('primaryDescentRate') + this.rng.gaussian(0, 2);
    } else {
      // 1-3 m/s per competition requirement §5.4
      targetRate = this.getConfig('secondaryDescentRate') + this.rng.gaussian(0, 0.3);
    }

    // Smooth velocity transition 
    const alpha = 0.1; // smoothing factor
    const currentDescentRate = Math.abs(this.verticalVelocity) || targetRate;
    const smoothedRate = currentDescentRate * (1 - alpha) + targetRate * alpha;

    this.altitude -= smoothedRate * dt;
    this.altitude = Math.max(0, this.altitude);

    // Wind drift
    const windSpeed = 2 + this.rng.gaussian(0, 0.5); // m/s
    const windDir = 45 + this.rng.gaussian(0, 5); // degrees
    this.windDriftX += windSpeed * Math.cos(windDir * Math.PI / 180) * dt;
    this.windDriftY += windSpeed * Math.sin(windDir * Math.PI / 180) * dt;

    // Parachute oscillation
    this.accelX = this.rng.gaussian(0, 0.3);
    this.accelY = this.rng.gaussian(0, 0.3);
    this.accelZ = -ISA.g + smoothedRate * 0.05 + this.rng.gaussian(0, 0.2);

    this._updateOrientation(dt, mode === 'secondary' ? 'stable' : 'descent');

    // Mechanical gyro stabilization (per competition req §13.25)
    if (mode === 'secondary') {
      this.gyroSpinRate = 180 + this.rng.gaussian(0, this.config.noise.gyroSpin);
    } else {
      this.gyroSpinRate = 50 + this.rng.gaussian(0, this.config.noise.gyroSpin * 2);
    }
  }

  // ─── Orientation ──────────────────────────────────────────────────────
  _updateOrientation(dt, mode) {
    const n = this.config.noise;
    switch (mode) {
      case 'ascent':
        this.roll += this.rng.gaussian(0, 2) * dt;
        this.pitch += this.rng.gaussian(0, 1.5) * dt;
        this.yaw += this.rng.gaussian(0, 3) * dt;
        break;
      case 'deploy':
        this.roll += this.rng.gaussian(0, 5) * dt;
        this.pitch += this.rng.gaussian(0, 5) * dt;
        this.yaw += this.rng.gaussian(0, 8) * dt;
        break;
      case 'descent':
        // Oscillating under parachute
        this.roll = 15 * Math.sin(this.missionTime * 0.5) + this.rng.gaussian(0, n.roll);
        this.pitch = 10 * Math.cos(this.missionTime * 0.7) + this.rng.gaussian(0, n.pitch);
        this.yaw += (5 + this.rng.gaussian(0, n.yaw)) * dt;
        break;
      case 'stable':
        // Gyro stabilized
        this.roll *= 0.95;
        this.roll += this.rng.gaussian(0, n.roll * 0.3);
        this.pitch *= 0.95;
        this.pitch += this.rng.gaussian(0, n.pitch * 0.3);
        this.yaw += this.rng.gaussian(0, n.yaw * 0.2) * dt;
        break;
    }
    this.angularVelocity = Math.sqrt(
      Math.pow(this.rng.gaussian(0, 5), 2) +
      Math.pow(this.rng.gaussian(0, 5), 2) +
      Math.pow(this.rng.gaussian(0, 5), 2)
    );
  }

  // ─── Pressure ──────────────────────────────────────────────────────────
  _updatePressure() {
    if (this.baroFailed) {
      this.pressure = this.lastBaroValue; // Stuck at last value
      return;
    }
    const truePressure = pressureAtAltitude(this.altitude, this.config.groundAltitudeASL);
    this.pressure = truePressure + this.rng.gaussian(0, this.config.noise.pressure);
  }

  // ─── Temperature ──────────────────────────────────────────────────────
  _updateTemperature() {
    const trueTemp = temperatureAtAltitude(this.altitude, this.config.groundTemp);
    this.temperature = trueTemp + this.rng.gaussian(0, this.config.noise.temperature);
    // Electronics self-heating bias
    this.temperature += 2.0;
  }

  // ─── Battery ──────────────────────────────────────────────────────────
  _updateBattery(dt) {
    const drainRate = this.getConfig('batteryDrainRate');
    this.voltage -= drainRate * dt;
    this.voltage += this.rng.gaussian(0, this.config.noise.voltage);
    this.voltage = Math.max(this.voltage, 5.5); // Floor
    
    if (this.voltage < 6.5) {
      this.addEvent('BATTERY', `Low battery: ${this.voltage.toFixed(2)}V`, 'WARNING');
    }
  }

  // ─── GNSS ──────────────────────────────────────────────────────────────
  _updateGNSS() {
    const n = this.config.noise;

    // Satellite count
    if (this.scenarioOverrides._gnssDropout && this.state >= FLIGHT_STATES.DESCENT) {
      // Gradual dropout
      this.gnssSats = Math.max(0, Math.floor(8 - this.rng.range(3, 8)));
    } else {
      this.gnssSats = Math.max(4, Math.min(12, Math.round(8 + this.rng.gaussian(0, 1))));
    }

    // Position with wind drift
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(this.gnssLat * Math.PI / 180);

    this.gnssLat = this.config.gnssRefLat + 
      this.windDriftY / metersPerDegLat +
      this.rng.gaussian(0, n.gnssLat * (this.gnssSats < 4 ? 10 : 1));

    this.gnssLon = this.config.gnssRefLon + 
      this.windDriftX / metersPerDegLon +
      this.rng.gaussian(0, n.gnssLon * (this.gnssSats < 4 ? 10 : 1));

    // GNSS altitude (differs slightly from barometric)
    this.gnssAlt = this.config.gnssRefAlt + this.altitude + 
      this.rng.gaussian(0, n.gnssAlt * (this.gnssSats < 4 ? 5 : 1));
  }

  // ─── Build Telemetry Packet ────────────────────────────────────────────
  buildTelemetryPacket() {
    const relAlt = this.altitude + this.calibrationOffsets.altitude;
    const adjGyro = this.gyroSpinRate + this.calibrationOffsets.gyro;
    
    // GNSS time: simulated UTC time string
    const gnssTime = this._formatGNSSTime();

    // Accelerometer data field: "ax;ay;az;roll;pitch;yaw" 
    // (configurable encoding - documented in README)
    const accelData = [
      (this.accelX + this.calibrationOffsets.accelX).toFixed(2),
      (this.accelY + this.calibrationOffsets.accelY).toFixed(2),
      (this.accelZ + this.calibrationOffsets.accelZ).toFixed(2),
      this.roll.toFixed(1),
      this.pitch.toFixed(1),
      this.yaw.toFixed(1)
    ].join(';');

    return {
      teamId: this.config.teamIdFull,
      missionTime: parseFloat(this.missionTime.toFixed(1)),
      packetCount: this.packetCount,
      altitude: parseFloat(relAlt.toFixed(1)),
      pressure: Math.round(this.pressure),
      temperature: parseFloat(this.temperature.toFixed(1)),
      voltage: parseFloat(this.voltage.toFixed(2)),
      gnssTime: gnssTime,
      gnssLatitude: parseFloat(this.gnssLat.toFixed(4)),
      gnssLongitude: parseFloat(this.gnssLon.toFixed(4)),
      gnssAltitude: parseFloat(this.gnssAlt.toFixed(1)),
      gnssSats: this.gnssSats,
      accelerometerData: accelData,
      gyroSpinRate: parseFloat(adjGyro.toFixed(1)),
      flightState: this.state,
      flightStateLabel: STATE_LABELS[this.state],
      // Parsed individual fields for GUI (not in CSV raw)
      accelX: parseFloat((this.accelX + this.calibrationOffsets.accelX).toFixed(2)),
      accelY: parseFloat((this.accelY + this.calibrationOffsets.accelY).toFixed(2)),
      accelZ: parseFloat((this.accelZ + this.calibrationOffsets.accelZ).toFixed(2)),
      roll: parseFloat(this.roll.toFixed(1)),
      pitch: parseFloat(this.pitch.toFixed(1)),
      yaw: parseFloat(this.yaw.toFixed(1)),
      verticalVelocity: parseFloat(this.verticalVelocity.toFixed(1)),
      angularVelocity: parseFloat(this.angularVelocity.toFixed(1)),
      // Metadata
      isSimulated: true,
      source: 'SIMULATION',
      timestamp: Date.now()
    };
  }

  _formatGNSSTime() {
    const now = new Date();
    now.setSeconds(now.getSeconds() + Math.floor(this.missionTime));
    return `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}:${String(now.getUTCSeconds()).padStart(2,'0')}`;
  }

  /**
   * Format a packet as competition-format CSV line
   * Field order per competition document §6.3:
   * TEAM_ID, TIME_STAMPING, PACKET_COUNT, ALTITUDE, PRESSURE, TEMP, VOLTAGE,
   * GNSS_TIME, GNSS_LATITUDE, GNSS_LONGITUDE, GNSS_ALTITUDE, GNSS_SATS,
   * ACCELEROMETER_DATA, GYRO_SPIN_RATE, FLIGHT_SOFTWARE_STATE, OPTIONAL_DATA
   */
  static packetToCSVLine(packet) {
    return [
      packet.teamId,
      packet.missionTime,
      packet.packetCount,
      packet.altitude,
      packet.pressure,
      packet.temperature,
      packet.voltage,
      packet.gnssTime,
      packet.gnssLatitude,
      packet.gnssLongitude,
      packet.gnssAltitude,
      packet.gnssSats,
      packet.accelerometerData,
      packet.gyroSpinRate,
      packet.flightState,
      '' // Optional data placeholder
    ].join(',');
  }

  static CSV_HEADERS = [
    'TEAM_ID', 'TIME_STAMPING', 'PACKET_COUNT', 'ALTITUDE',
    'PRESSURE', 'TEMP', 'VOLTAGE', 'GNSS_TIME',
    'GNSS_LATITUDE', 'GNSS_LONGITUDE', 'GNSS_ALTITUDE', 'GNSS_SATS',
    'ACCELEROMETER_DATA', 'GYRO_SPIN_RATE', 'FLIGHT_SOFTWARE_STATE', 'OPTIONAL_DATA'
  ];

  getStatus() {
    return {
      running: this.running,
      paused: this.paused,
      finished: this.finished,
      telemetryEnabled: this.telemetryEnabled,
      missionTime: this.missionTime,
      packetCount: this.packetCount,
      state: this.state,
      stateLabel: STATE_LABELS[this.state],
      altitude: this.altitude
    };
  }
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SimulationEngine, FLIGHT_STATES, STATE_LABELS, SCENARIOS, DEFAULT_CONFIG, pressureAtAltitude, temperatureAtAltitude, SeededRandom };
}
if (typeof window !== 'undefined') {
  window.SimulationEngine = SimulationEngine;
  window.FLIGHT_STATES = FLIGHT_STATES;
  window.STATE_LABELS = STATE_LABELS;
  window.SCENARIOS = SCENARIOS;
  window.DEFAULT_CONFIG = DEFAULT_CONFIG;
}
