/**
 * CAN-7USAT Data Logger
 * 
 * Records telemetry to CSV files per competition requirements §6.3.
 * Filename format: Flight_<TEAM_ID>.csv
 * 
 * Field order follows the competition-specified telemetry format.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CSV_HEADERS = [
  'TEAM_ID', 'TIME_STAMPING', 'PACKET_COUNT', 'ALTITUDE',
  'PRESSURE', 'TEMP', 'VOLTAGE', 'GNSS_TIME',
  'GNSS_LATITUDE', 'GNSS_LONGITUDE', 'GNSS_ALTITUDE', 'GNSS_SATS',
  'ACCELEROMETER_DATA', 'GYRO_SPIN_RATE', 'FLIGHT_SOFTWARE_STATE', 'OPTIONAL_DATA'
];

class DataLogger {
  constructor(options = {}) {
    this.teamId = options.teamId || '038';
    this.outputDir = options.outputDir || path.join(process.cwd(), 'data');
    this.recording = false;
    this.recordCount = 0;
    this.filePath = null;
    this.writeStream = null;
    this.source = 'UNKNOWN'; // 'SIMULATION' or 'LIVE'
    this.startTime = null;
    this.errors = [];
  }

  /**
   * Generate the competition-format filename: Flight_<TEAM_ID>.csv
   * Adds timestamp suffix to prevent accidental overwriting.
   */
  _generateFilename(preventOverwrite = true) {
    const base = `Flight_${this.teamId}`;
    if (preventOverwrite) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      return `${base}_${ts}.csv`;
    }
    return `${base}.csv`;
  }

  /**
   * Start recording telemetry
   * @param {string} source - 'SIMULATION' or 'LIVE'
   * @param {string} customDir - Optional custom output directory
   * @returns {Object} Status of recording start
   */
  startRecording(source = 'SIMULATION', customDir = null) {
    if (this.recording) {
      return { success: false, message: 'Already recording', filePath: this.filePath };
    }

    const dir = customDir || this.outputDir;

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      return { success: false, message: `Failed to create directory: ${err.message}` };
    }

    this.source = source;
    const filename = this._generateFilename(true);
    this.filePath = path.join(dir, filename);

    try {
      this.writeStream = fs.createWriteStream(this.filePath, { flags: 'w', encoding: 'utf8' });
      
      // Write metadata comment
      this.writeStream.write(`# CAN-7USAT Ground Station Telemetry Log\n`);
      this.writeStream.write(`# Team: ${this.teamId}\n`);
      this.writeStream.write(`# Source: ${source}\n`);
      this.writeStream.write(`# Started: ${new Date().toISOString()}\n`);
      this.writeStream.write(`# Format: Competition Document §6.3 field order\n`);
      if (source === 'SIMULATION') {
        this.writeStream.write(`# WARNING: This file contains SIMULATED data, not live flight telemetry.\n`);
      }
      this.writeStream.write(`#\n`);
      
      // Write CSV headers
      this.writeStream.write(CSV_HEADERS.join(',') + '\n');

      this.recording = true;
      this.recordCount = 0;
      this.startTime = Date.now();

      return {
        success: true,
        message: 'Recording started',
        filePath: this.filePath,
        filename: filename,
        source: source
      };
    } catch (err) {
      return { success: false, message: `Failed to start recording: ${err.message}` };
    }
  }

  /**
   * Log a telemetry packet
   * @param {Object} packet - Parsed telemetry packet
   * @returns {boolean} Success
   */
  logPacket(packet) {
    if (!this.recording || !this.writeStream) return false;

    try {
      const line = [
        packet.teamId || this.teamId,
        packet.missionTime,
        packet.packetCount,
        packet.altitude,
        packet.pressure,
        packet.temperature,
        packet.voltage,
        packet.gnssTime || '',
        packet.gnssLatitude,
        packet.gnssLongitude,
        packet.gnssAltitude,
        packet.gnssSats,
        packet.accelerometerData || '',
        packet.gyroSpinRate,
        packet.flightState,
        packet.optionalData || ''
      ].join(',');

      this.writeStream.write(line + '\n');
      this.recordCount++;
      return true;
    } catch (err) {
      this.errors.push({ time: Date.now(), error: err.message });
      return false;
    }
  }

  /**
   * Stop recording and close the file
   */
  stopRecording() {
    if (!this.recording) {
      return { success: false, message: 'Not recording' };
    }

    return new Promise((resolve) => {
      this.writeStream.end(() => {
        const result = {
          success: true,
          message: 'Recording stopped',
          filePath: this.filePath,
          recordCount: this.recordCount,
          source: this.source,
          duration: Date.now() - this.startTime
        };
        this.recording = false;
        this.writeStream = null;
        resolve(result);
      });
    });
  }

  /**
   * Get current recording status
   */
  getStatus() {
    return {
      recording: this.recording,
      filePath: this.filePath,
      recordCount: this.recordCount,
      source: this.source,
      startTime: this.startTime,
      errors: this.errors.slice(-5)
    };
  }

  /**
   * Set output directory
   */
  setOutputDir(dir) {
    if (this.recording) {
      return { success: false, message: 'Cannot change directory while recording' };
    }
    this.outputDir = dir;
    return { success: true, message: `Output directory set to: ${dir}` };
  }

  /**
   * List existing flight files
   */
  listFlightFiles() {
    try {
      if (!fs.existsSync(this.outputDir)) return [];
      const files = fs.readdirSync(this.outputDir)
        .filter(f => f.startsWith('Flight_') && f.endsWith('.csv'))
        .map(f => {
          const fullPath = path.join(this.outputDir, f);
          const stats = fs.statSync(fullPath);
          return {
            name: f,
            path: fullPath,
            size: stats.size,
            modified: stats.mtime.toISOString()
          };
        });
      return files;
    } catch (err) {
      return [];
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DataLogger, CSV_HEADERS };
}
