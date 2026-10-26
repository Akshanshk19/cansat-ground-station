const fs = require('fs');
const path = require('path');
const { DataLogger, CSV_HEADERS } = require('../src/logging/dataLogger');
const { EventLogger } = require('../src/logging/eventLogger');
const { CommandProcessor, COMMANDS } = require('../src/commands/commandProcessor');
const { SerialInterface, CONNECTION_STATES } = require('../src/serial/serialInterface');
const { SimulationEngine } = require('../src/simulation/physics');

describe('CAN-7USAT Logging and Command Processing', () => {
  const testDir = path.join(__dirname, 'temp_test_data');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(async () => {
    await new Promise(r => setTimeout(r, 100));
    if (fs.existsSync(testDir)) {
      try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  test('DataLogger logs CSV compliant with §6.3 headers and field ordering', async () => {
    const logger = new DataLogger({ teamId: '038', outputDir: testDir });
    const startRes = logger.startRecording('SIMULATION');
    expect(startRes.success).toBe(true);
    expect(logger.recording).toBe(true);

    const sim = new SimulationEngine();
    const packet = sim.step();

    const logged = logger.logPacket(packet);
    expect(logged).toBe(true);
    expect(logger.recordCount).toBe(1);

    const stopRes = await logger.stopRecording();
    expect(stopRes.success).toBe(true);
    expect(logger.recording).toBe(false);

    // Verify written file
    const content = fs.readFileSync(startRes.filePath, 'utf8');
    expect(content).toContain(CSV_HEADERS.join(','));
    expect(content).toContain('2026-IN-SPACe-CAN-7USAT-038');
  });

  test('EventLogger records, filters, and limits events properly', () => {
    const eventFile = path.join(testDir, 'test_events.log');
    const el = new EventLogger({ maxEvents: 50, logFile: eventFile });

    el.log('APP', 'System started', 'INFO');
    el.log('FAULT', 'Sensor failure', 'ERROR');
    el.log('COMMAND', 'Calibration executed', 'INFO');

    const errorEvents = el.getEvents({ severity: 'ERROR' });
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].type).toBe('FAULT');

    const appEvents = el.getEvents({ type: 'APP' });
    expect(appEvents.length).toBe(1);

    el.close();
  });

  test('CommandProcessor validates simulation vs live commands safely', () => {
    const sim = new SimulationEngine();
    const cp = new CommandProcessor(sim);

    // In simulation mode, START_TELEMETRY succeeds
    const res1 = cp.execute('START_TELEMETRY');
    expect(res1.status).toBe('ACKNOWLEDGED');

    // Unknown command
    const res2 = cp.execute('NON_EXISTENT_COMMAND');
    expect(res2.status).toBe('REJECTED');

    // Dangerous command requiring confirmation
    const res3 = cp.execute('INJECT_TEST_FAULT', { faultType: 'BARO_FAILURE' }, false);
    expect(res3.status).toBe('AWAITING_CONFIRMATION');

    // Dangerous command with confirmation
    const res4 = cp.execute('INJECT_TEST_FAULT', { faultType: 'BARO_FAILURE' }, true);
    expect(res4.status).toBe('ACKNOWLEDGED');

    // In LIVE mode, simulation-only commands must be rejected
    cp.setMode('LIVE');
    const res5 = cp.execute('RESET_SIMULATION');
    expect(res5.status).toBe('REJECTED');
  });

  test('SerialInterface protects against unauthorized live transmission', async () => {
    const si = new SerialInterface();
    expect(si.getStatus().state).toBe(CONNECTION_STATES.DISCONNECTED);

    // Sending without confirmation must fail
    const sendRes = await si.sendRaw('DUMMY_COMMAND', false);
    expect(sendRes.success).toBe(false);
    expect(sendRes.message).toContain('explicit confirmation');
  });
});
