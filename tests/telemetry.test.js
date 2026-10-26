const { TelemetryParser, REQUIRED_FIELD_COUNT, VALID_STATES } = require('../src/telemetry/parser');
const { SimulationEngine } = require('../src/simulation/physics');

describe('CAN-7USAT Telemetry Parser (Competition Guidelines §6.3)', () => {
  let parser;
  const TEAM_ID = '2026-IN-SPACe-CAN-7USAT-038';

  beforeEach(() => {
    parser = new TelemetryParser(TEAM_ID);
  });

  test('parses a fully valid competition-spec telemetry packet', () => {
    const validLine = `${TEAM_ID},12.5,15,650.2,93820,24.1,8.32,12:30:45,26.7412,83.8894,730.2,9,0.02;0.05;-9.81;1.2;-0.5;45.0,2.1,5,OPTIONAL_SCIENCE_PAYLOAD`;
    const pkt = parser.parseLine(validLine);

    expect(pkt).not.toBeNull();
    expect(pkt.teamId).toBe(TEAM_ID);
    expect(pkt.missionTime).toBe(12.5);
    expect(pkt.packetCount).toBe(15);
    expect(pkt.altitude).toBe(650.2);
    expect(pkt.pressure).toBe(93820);
    expect(pkt.temperature).toBe(24.1);
    expect(pkt.voltage).toBe(8.32);
    expect(pkt.gnssTime).toBe('12:30:45');
    expect(pkt.gnssLatitude).toBe(26.7412);
    expect(pkt.gnssLongitude).toBe(83.8894);
    expect(pkt.gnssAltitude).toBe(730.2);
    expect(pkt.gnssSats).toBe(9);
    expect(pkt.accelX).toBe(0.02);
    expect(pkt.accelY).toBe(0.05);
    expect(pkt.accelZ).toBe(-9.81);
    expect(pkt.roll).toBe(1.2);
    expect(pkt.pitch).toBe(-0.5);
    expect(pkt.yaw).toBe(45.0);
    expect(pkt.gyroSpinRate).toBe(2.1);
    expect(pkt.flightState).toBe(5);
    expect(pkt.optionalData).toBe('OPTIONAL_SCIENCE_PAYLOAD');
    expect(pkt.valid).toBe(true);
  });

  test('handles stream buffer fragmentation via feed()', () => {
    const chunk1 = `${TEAM_ID},1.0,1,10.0,101000,28.0,8.4,12:00:01,26.74,83.88,90.0,8,0;0;-9.8;0;0;0,0.0,2,\r\n${TEAM_ID},2.0,2,20.0,100800,27.9,8.39,12:00:02,26.`;
    const chunk2 = `74,83.88,100.0,8,0;0;-9.8;0;0;0,0.0,3,\r\n`;

    const packets1 = parser.feed(chunk1);
    expect(packets1.length).toBe(1);
    expect(packets1[0].packetCount).toBe(1);

    const packets2 = parser.feed(chunk2);
    expect(packets2.length).toBe(1);
    expect(packets2[0].packetCount).toBe(2);
  });

  test('detects sequence gaps and duplicates', () => {
    const line1 = `${TEAM_ID},1.0,1,0,101325,25.0,8.4,12:00:01,26.74,83.88,80,8,0;0;-9.8;0;0;0,0,2,`;
    const line2 = `${TEAM_ID},2.0,1,0,101325,25.0,8.4,12:00:02,26.74,83.88,80,8,0;0;-9.8;0;0;0,0,2,`; // duplicate count 1
    const line3 = `${TEAM_ID},3.0,5,0,101325,25.0,8.4,12:00:03,26.74,83.88,80,8,0;0;-9.8;0;0;0,0,2,`; // gap (missed 2, 3, 4 -> gap = 3)

    parser.parseLine(line1);
    expect(parser.duplicates).toBe(0);

    parser.parseLine(line2);
    expect(parser.duplicates).toBe(1);

    parser.parseLine(line3);
    expect(parser.sequenceGaps).toBe(3);
  });

  test('rejects malformed packets with insufficient fields', () => {
    const malformed = `${TEAM_ID},1.0,1,100.0,100000`;
    const pkt = parser.parseLine(malformed);
    expect(pkt).toBeNull();
    expect(parser.invalidPackets).toBe(1);
  });

  test('validates coordinates and voltages', () => {
    const invalidCoords = `${TEAM_ID},1.0,1,0,101325,25.0,25.0,12:00:01,195.0,83.88,80,8,0;0;-9.8;0;0;0,0,2,`;
    parser.parseLine(invalidCoords);
    expect(parser.parseErrors.some(e => e.type === 'GNSS_LAT')).toBe(true);
    expect(parser.parseErrors.some(e => e.type === 'VOLTAGE')).toBe(true);
  });
});
