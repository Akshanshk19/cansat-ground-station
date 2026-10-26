/**
 * CAN-7USAT Telemetry Parser
 * 
 * Parses ASCII comma-separated telemetry per competition document §6.3.
 * Field order: TEAM_ID, TIME_STAMPING, PACKET_COUNT, ALTITUDE, PRESSURE,
 * TEMP, VOLTAGE, GNSS_TIME, GNSS_LATITUDE, GNSS_LONGITUDE, GNSS_ALTITUDE,
 * GNSS_SATS, ACCELEROMETER_DATA, GYRO_SPIN_RATE, FLIGHT_SOFTWARE_STATE,
 * OPTIONAL_DATA
 */

'use strict';

const REQUIRED_FIELD_COUNT = 15; // Minimum fields (without optional)
const VALID_STATES = [0, 1, 2, 3, 4, 5, 6, 7];

class TelemetryParser {
  constructor(expectedTeamId = '2026-IN-SPACe-CAN-7USAT-038') {
    this.expectedTeamId = expectedTeamId;
    this.lastPacketCount = -1;
    this.parseErrors = [];
    this.validPackets = 0;
    this.invalidPackets = 0;
    this.sequenceGaps = 0;
    this.duplicates = 0;
    this.buffer = '';
    this.fieldDecoderConfig = {
      // Accelerometer data encoding: "ax;ay;az;roll;pitch;yaw"
      accelSeparator: ';',
      accelFieldCount: 6 // ax, ay, az, roll, pitch, yaw
    };
  }

  /**
   * Feed raw bytes/string into the parser buffer.
   * Handles partial reads and multiple delimiters (\r, \n, \r\n).
   * Returns array of parsed packets.
   */
  feed(data) {
    this.buffer += data;
    const packets = [];
    
    // Split on \r\n, \r, or \n
    const lines = this.buffer.split(/\r\n|\r|\n/);
    
    // Keep the last incomplete segment in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      
      const result = this.parseLine(trimmed);
      if (result) {
        packets.push(result);
      }
    }

    return packets;
  }

  /**
   * Parse a single telemetry line
   * @param {string} line - Raw CSV line
   * @returns {Object|null} Parsed packet or null on error
   */
  parseLine(line) {
    const fields = line.split(',');

    // ─── Field Count Validation ─────────────────────────────────────
    if (fields.length < REQUIRED_FIELD_COUNT) {
      this._addError('FIELD_COUNT', `Expected at least ${REQUIRED_FIELD_COUNT} fields, got ${fields.length}`, line);
      return null;
    }

    try {
      // ─── Parse Each Field ─────────────────────────────────────────
      const teamId = fields[0].trim();
      const missionTime = this._parseFloat(fields[1], 'TIME_STAMPING');
      const packetCount = this._parseInt(fields[2], 'PACKET_COUNT');
      const altitude = this._parseFloat(fields[3], 'ALTITUDE');
      const pressure = this._parseInt(fields[4], 'PRESSURE');
      const temperature = this._parseFloat(fields[5], 'TEMP');
      const voltage = this._parseFloat(fields[6], 'VOLTAGE');
      const gnssTime = fields[7].trim();
      const gnssLatitude = this._parseFloat(fields[8], 'GNSS_LATITUDE');
      const gnssLongitude = this._parseFloat(fields[9], 'GNSS_LONGITUDE');
      const gnssAltitude = this._parseFloat(fields[10], 'GNSS_ALTITUDE');
      const gnssSats = this._parseInt(fields[11], 'GNSS_SATS');
      const accelDataRaw = fields[12].trim();
      const gyroSpinRate = this._parseFloat(fields[13], 'GYRO_SPIN_RATE');
      const flightState = this._parseInt(fields[14], 'FLIGHT_SOFTWARE_STATE');
      const optionalData = fields.length > 15 ? fields.slice(15).join(',').trim() : '';

      // ─── Validation ───────────────────────────────────────────────
      
      // Team ID check
      if (teamId !== this.expectedTeamId) {
        this._addError('TEAM_ID', `Unexpected team ID: "${teamId}", expected "${this.expectedTeamId}"`, line);
        // Still parse but flag it
      }

      // Mission time must be non-negative
      if (missionTime < 0) {
        this._addError('TIME_RANGE', `Negative mission time: ${missionTime}`, line);
        return null;
      }

      // Flight state validation
      if (!VALID_STATES.includes(flightState)) {
        this._addError('INVALID_STATE', `Unknown flight state: ${flightState}`, line);
      }

      // Sequence gap detection
      if (this.lastPacketCount >= 0) {
        if (packetCount === this.lastPacketCount) {
          this.duplicates++;
          this._addError('DUPLICATE', `Duplicate packet count: ${packetCount}`, line);
        } else if (packetCount < this.lastPacketCount) {
          this._addError('SEQUENCE', `Packet count went backwards: ${packetCount} < ${this.lastPacketCount}`, line);
        } else if (packetCount > this.lastPacketCount + 1) {
          const gap = packetCount - this.lastPacketCount - 1;
          this.sequenceGaps += gap;
          this._addError('GAP', `Sequence gap of ${gap} packets (${this.lastPacketCount} → ${packetCount})`, line);
        }
      }
      this.lastPacketCount = packetCount;

      // GNSS coordinate validation
      if (gnssLatitude < -90 || gnssLatitude > 90) {
        this._addError('GNSS_LAT', `Invalid latitude: ${gnssLatitude}`, line);
      }
      if (gnssLongitude < -180 || gnssLongitude > 180) {
        this._addError('GNSS_LON', `Invalid longitude: ${gnssLongitude}`, line);
      }

      // Sat count must be non-negative integer
      if (gnssSats < 0 || !Number.isInteger(gnssSats)) {
        this._addError('GNSS_SATS', `Invalid satellite count: ${gnssSats}`, line);
      }

      // Voltage range check
      if (voltage < 0 || voltage > 20) {
        this._addError('VOLTAGE', `Suspicious voltage: ${voltage}V`, line);
      }

      // ─── Decode Accelerometer Data ────────────────────────────────
      const accelParsed = this._parseAccelerometerData(accelDataRaw);

      this.validPackets++;

      return {
        raw: line,
        teamId,
        missionTime,
        packetCount,
        altitude,
        pressure,
        temperature,
        voltage,
        gnssTime,
        gnssLatitude,
        gnssLongitude,
        gnssAltitude,
        gnssSats,
        accelerometerData: accelDataRaw,
        accelX: accelParsed.ax,
        accelY: accelParsed.ay,
        accelZ: accelParsed.az,
        roll: accelParsed.roll,
        pitch: accelParsed.pitch,
        yaw: accelParsed.yaw,
        gyroSpinRate,
        flightState,
        optionalData,
        verticalVelocity: null, // Computed by the data pipeline
        angularVelocity: null,
        isSimulated: false,
        source: 'LIVE',
        timestamp: Date.now(),
        valid: true
      };

    } catch (err) {
      this._addError('PARSE', err.message, line);
      this.invalidPackets++;
      return null;
    }
  }

  /**
   * Parse accelerometer data field.
   * Expected encoding: "ax;ay;az;roll;pitch;yaw"
   * This encoding is configurable since the competition document
   * does not fully specify how all axes and orientation are encoded
   * in a single field.
   */
  _parseAccelerometerData(raw) {
    const sep = this.fieldDecoderConfig.accelSeparator;
    const parts = raw.split(sep);
    
    if (parts.length >= 6) {
      return {
        ax: parseFloat(parts[0]) || 0,
        ay: parseFloat(parts[1]) || 0,
        az: parseFloat(parts[2]) || 0,
        roll: parseFloat(parts[3]) || 0,
        pitch: parseFloat(parts[4]) || 0,
        yaw: parseFloat(parts[5]) || 0
      };
    } else if (parts.length >= 3) {
      // Fallback: only acceleration data
      return {
        ax: parseFloat(parts[0]) || 0,
        ay: parseFloat(parts[1]) || 0,
        az: parseFloat(parts[2]) || 0,
        roll: 0, pitch: 0, yaw: 0
      };
    } else {
      // Single value or unparseable
      return { ax: parseFloat(raw) || 0, ay: 0, az: 0, roll: 0, pitch: 0, yaw: 0 };
    }
  }

  _parseFloat(value, fieldName) {
    const v = parseFloat(value);
    if (isNaN(v)) throw new Error(`Invalid numeric value for ${fieldName}: "${value}"`);
    return v;
  }

  _parseInt(value, fieldName) {
    const v = parseInt(value, 10);
    if (isNaN(v)) throw new Error(`Invalid integer value for ${fieldName}: "${value}"`);
    return v;
  }

  _addError(type, message, rawLine) {
    this.invalidPackets++;
    const error = {
      type,
      message,
      rawLine: rawLine ? rawLine.substring(0, 200) : '',
      timestamp: Date.now()
    };
    this.parseErrors.push(error);
    // Keep only last 1000 errors
    if (this.parseErrors.length > 1000) {
      this.parseErrors = this.parseErrors.slice(-500);
    }
  }

  getStats() {
    return {
      validPackets: this.validPackets,
      invalidPackets: this.invalidPackets,
      sequenceGaps: this.sequenceGaps,
      duplicates: this.duplicates,
      lastPacketCount: this.lastPacketCount,
      errorCount: this.parseErrors.length,
      recentErrors: this.parseErrors.slice(-10)
    };
  }

  reset() {
    this.lastPacketCount = -1;
    this.parseErrors = [];
    this.validPackets = 0;
    this.invalidPackets = 0;
    this.sequenceGaps = 0;
    this.duplicates = 0;
    this.buffer = '';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TelemetryParser, REQUIRED_FIELD_COUNT, VALID_STATES };
}
if (typeof window !== 'undefined') {
  window.TelemetryParser = TelemetryParser;
}
