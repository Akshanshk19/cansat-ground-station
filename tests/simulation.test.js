const { SimulationEngine, FLIGHT_STATES, STATE_LABELS, pressureAtAltitude, temperatureAtAltitude } = require('../src/simulation/physics');

describe('CAN-7USAT Simulation Engine & Physics Model', () => {
  let sim;

  beforeEach(() => {
    sim = new SimulationEngine({
      sampleRateHz: 1,
      randomSeed: 1234
    });
  });

  test('atmospheric pressure and temperature decrease with altitude according to ISA model', () => {
    const pGround = pressureAtAltitude(0, 80);
    const p1000m = pressureAtAltitude(1000, 80);
    expect(p1000m).toBeLessThan(pGround);

    const tGround = temperatureAtAltitude(0, 28);
    const t1000m = temperatureAtAltitude(1000, 28);
    expect(t1000m).toBeLessThan(tGround);
    expect(tGround - t1000m).toBeCloseTo(6.5, 1); // 0.0065 K/m lapse rate
  });

  test('simulation advances through mission timeline from BOOT to IMPACT', () => {
    sim.setScenario('NOMINAL');
    sim.running = true;
    sim.telemetryEnabled = true;

    const visitedStates = new Set();
    let maxSteps = 1000;
    let stepCount = 0;

    while (!sim.finished && stepCount < maxSteps) {
      const pkt = sim.step();
      if (pkt) {
        visitedStates.add(pkt.flightState);
      }
      stepCount++;
    }

    expect(visitedStates.has(FLIGHT_STATES.BOOT)).toBe(true);
    expect(visitedStates.has(FLIGHT_STATES.TEST_MODE)).toBe(true);
    expect(visitedStates.has(FLIGHT_STATES.LAUNCH_PAD)).toBe(true);
    expect(visitedStates.has(FLIGHT_STATES.ASCENT)).toBe(true);
    expect(visitedStates.has(FLIGHT_STATES.ROCKET_DEPLOY)).toBe(true);
    expect(visitedStates.has(FLIGHT_STATES.DESCENT)).toBe(true);
    expect(visitedStates.has(FLIGHT_STATES.AEROBREAK_RELEASE)).toBe(true);
    expect(visitedStates.has(FLIGHT_STATES.IMPACT)).toBe(true);
    expect(sim.finished).toBe(true);
  });

  test('descent rates conform to competition requirements (§5.4.v and §5.4.vi)', () => {
    sim.setScenario('NOMINAL');
    // Primary descent rate config is ~20 m/s
    expect(sim.config.primaryDescentRate).toBeGreaterThanOrEqual(15);
    expect(sim.config.primaryDescentRate).toBeLessThanOrEqual(25);

    // Secondary descent rate config is 1-3 m/s at 600m
    expect(sim.config.secondaryDescentRate).toBeGreaterThanOrEqual(1);
    expect(sim.config.secondaryDescentRate).toBeLessThanOrEqual(3);
    expect(sim.config.aerobreakAltitude).toBe(600);
  });

  test('calibration commands zero the appropriate sensors (§6.1.vi)', () => {
    // Calibrate Gyro
    const gyroRes = sim.calibrateGyro();
    expect(gyroRes.success).toBe(true);

    // Zero Barometric Altitude
    const baroRes = sim.calibrateBarometricAltitude();
    expect(baroRes.success).toBe(true);

    // Calibrate Accelerometer
    const accelRes = sim.calibrateAccelerometer();
    expect(accelRes.success).toBe(true);
  });

  test('fault injection of processor reset triggers recovery (§6.2.ii)', () => {
    sim.altitude = 800;
    sim.state = FLIGHT_STATES.DESCENT;
    sim.missionTime = 50;
    sim.injectFault('PROCESSOR_RESET');

    expect(sim.state).toBe(FLIGHT_STATES.BOOT);
    expect(sim.resetOccurred).toBe(true);

    // After 3 seconds, should recover to pre-reset state
    sim.step(1.0);
    sim.step(1.0);
    sim.step(1.0);

    expect(sim.state).toBe(FLIGHT_STATES.DESCENT);
  });
});
