/**
 * CAN-7USAT Ground Station - Event Logger
 * 
 * Records application events, state transitions, commands, and errors.
 * Events are persisted and can be filtered by type and severity.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const EVENT_TYPES = [
  'APP', 'TELEMETRY', 'STATE_TRANSITION', 'COMMAND',
  'CALIBRATION', 'FAULT', 'RECOVERY', 'BATTERY',
  'GNSS', 'DEPLOY', 'AEROBREAK', 'LANDING',
  'MISSION_COMPLETE', 'RECORDING', 'CONNECTION',
  'SCENARIO', 'SIMULATION', 'ERROR', 'WARNING'
];

const SEVERITY_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];

class EventLogger {
  constructor(options = {}) {
    this.maxEvents = options.maxEvents || 10000;
    this.events = [];
    this.logFile = options.logFile || null;
    this.writeStream = null;
    this.listeners = [];

    if (this.logFile) {
      this._openLogFile();
    }
  }

  _openLogFile() {
    try {
      const dir = path.dirname(this.logFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.writeStream = fs.createWriteStream(this.logFile, { flags: 'a', encoding: 'utf8' });
      this.writeStream.write(`\n--- Session started: ${new Date().toISOString()} ---\n`);
    } catch (err) {
      console.error('Failed to open event log file:', err.message);
    }
  }

  onEvent(callback) {
    this.listeners.push(callback);
  }

  log(type, message, severity = 'INFO', data = null) {
    const event = {
      id: this.events.length + 1,
      timestamp: new Date().toISOString(),
      type,
      severity,
      message,
      data
    };

    this.events.push(event);
    
    // Trim if exceeding max
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-Math.floor(this.maxEvents * 0.8));
    }

    // Write to file
    if (this.writeStream) {
      this.writeStream.write(
        `[${event.timestamp}] [${severity}] [${type}] ${message}\n`
      );
    }

    // Notify listeners
    this.listeners.forEach(cb => cb(event));

    return event;
  }

  getEvents(filters = {}) {
    let result = this.events;

    if (filters.type) {
      result = result.filter(e => e.type === filters.type);
    }
    if (filters.severity) {
      const minIdx = SEVERITY_LEVELS.indexOf(filters.severity);
      result = result.filter(e => SEVERITY_LEVELS.indexOf(e.severity) >= minIdx);
    }
    if (filters.since) {
      result = result.filter(e => new Date(e.timestamp) >= new Date(filters.since));
    }
    if (filters.limit) {
      result = result.slice(-filters.limit);
    }

    return result;
  }

  clear() {
    this.events = [];
  }

  close() {
    if (this.writeStream) {
      this.writeStream.end();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EventLogger, EVENT_TYPES, SEVERITY_LEVELS };
}
