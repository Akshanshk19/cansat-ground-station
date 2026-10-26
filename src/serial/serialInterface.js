/**
 * CAN-7USAT Serial Radio Interface
 * 
 * Abstraction layer for USB serial radio communication.
 * Supports future integration with SX1262 LoRa or XBee radios.
 * 
 * IMPORTANT: No RF transmission occurs in simulation mode.
 * Live radio mode is disabled until hardware is explicitly configured.
 */

'use strict';

let SerialPort;
try {
  SerialPort = require('serialport').SerialPort;
} catch (e) {
  // serialport module not available - will use mock
  SerialPort = null;
}

const CONNECTION_STATES = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECEIVING: 'RECEIVING_TELEMETRY',
  LOST: 'CONNECTION_LOST',
  ERROR: 'ERROR'
};

const DEFAULT_RADIO_CONFIG = {
  module: 'SX1262 LoRa',
  primaryFrequency: 865.50,      // MHz (configuration default only)
  backupFrequency: 867.25,       // MHz
  bandwidth: 125,                 // kHz
  spreadingFactor: 7,            // SF7
  codingRate: '4/5',
  syncWord: '0xA4',
  txPower: 10,                   // dBm
  preambleLength: 8,             // symbols
  teamId: '038',
  baudRate: 115200,              // Default baud rate (not confirmed)
  dataBits: 8,
  stopBits: 1,
  parity: 'none'
};

class SerialInterface {
  constructor(config = {}) {
    this.config = { ...DEFAULT_RADIO_CONFIG, ...config };
    this.state = CONNECTION_STATES.DISCONNECTED;
    this.port = null;
    this.portPath = null;
    this.bytesReceived = 0;
    this.packetsReceived = 0;
    this.lastDataTime = null;
    this.listeners = [];
    this.dataBuffer = '';
    this.connectionTimeout = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  onData(callback) {
    this.listeners.push(callback);
  }

  _emit(data) {
    this.listeners.forEach(cb => cb(data));
  }

  /**
   * List available serial ports
   */
  async listPorts() {
    if (!SerialPort) {
      return {
        available: false,
        message: 'Serial port module not available. Install with: npm install serialport',
        ports: []
      };
    }

    try {
      const ports = await SerialPort.list();
      return {
        available: true,
        ports: ports.map(p => ({
          path: p.path,
          manufacturer: p.manufacturer || 'Unknown',
          vendorId: p.vendorId || '',
          productId: p.productId || '',
          serialNumber: p.serialNumber || ''
        }))
      };
    } catch (err) {
      return { available: false, message: err.message, ports: [] };
    }
  }

  /**
   * Connect to a serial port
   * WARNING: Does not transmit automatically. 
   * Only receives data from the connected device.
   */
  async connect(portPath, options = {}) {
    if (this.state === CONNECTION_STATES.CONNECTED || 
        this.state === CONNECTION_STATES.RECEIVING) {
      return { success: false, message: 'Already connected' };
    }

    if (!SerialPort) {
      return { 
        success: false, 
        message: 'Serial port module not available. Hardware interface unavailable.' 
      };
    }

    this.portPath = portPath;
    this.state = CONNECTION_STATES.CONNECTING;

    const portOptions = {
      path: portPath,
      baudRate: options.baudRate || this.config.baudRate,
      dataBits: options.dataBits || this.config.dataBits,
      stopBits: options.stopBits || this.config.stopBits,
      parity: options.parity || this.config.parity,
      autoOpen: false
    };

    return new Promise((resolve) => {
      try {
        this.port = new SerialPort(portOptions);

        this.port.on('data', (data) => {
          this._onData(data);
        });

        this.port.on('error', (err) => {
          this.state = CONNECTION_STATES.ERROR;
          this._emit({ type: 'error', message: err.message });
        });

        this.port.on('close', () => {
          this.state = CONNECTION_STATES.DISCONNECTED;
          this._emit({ type: 'disconnected' });
        });

        this.port.open((err) => {
          if (err) {
            this.state = CONNECTION_STATES.ERROR;
            resolve({ success: false, message: err.message });
          } else {
            this.state = CONNECTION_STATES.CONNECTED;
            this.reconnectAttempts = 0;
            this._startConnectionMonitor();
            resolve({ success: true, message: `Connected to ${portPath}` });
          }
        });
      } catch (err) {
        this.state = CONNECTION_STATES.ERROR;
        resolve({ success: false, message: err.message });
      }
    });
  }

  /**
   * Disconnect from the serial port
   */
  async disconnect() {
    if (this.connectionTimeout) {
      clearInterval(this.connectionTimeout);
    }

    if (!this.port || !this.port.isOpen) {
      this.state = CONNECTION_STATES.DISCONNECTED;
      return { success: true, message: 'Already disconnected' };
    }

    return new Promise((resolve) => {
      this.port.close((err) => {
        this.state = CONNECTION_STATES.DISCONNECTED;
        this.port = null;
        resolve({ success: true, message: err ? err.message : 'Disconnected' });
      });
    });
  }

  _onData(rawData) {
    const text = rawData.toString('utf8');
    this.bytesReceived += rawData.length;
    this.lastDataTime = Date.now();
    this.state = CONNECTION_STATES.RECEIVING;

    // Buffer and split on line boundaries
    this.dataBuffer += text;
    const lines = this.dataBuffer.split(/\r\n|\r|\n/);
    this.dataBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        this.packetsReceived++;
        this._emit({ type: 'packet', data: line.trim(), timestamp: Date.now() });
      }
    }
  }

  _startConnectionMonitor() {
    this.connectionTimeout = setInterval(() => {
      if (this.lastDataTime && (Date.now() - this.lastDataTime > 10000)) {
        this.state = CONNECTION_STATES.LOST;
        this._emit({ type: 'connectionLost', lastData: this.lastDataTime });
      }
    }, 5000);
  }

  /**
   * Send raw data through the serial port
   * REQUIRES explicit confirmation for live hardware
   */
  async sendRaw(data, confirmed = false) {
    if (!confirmed) {
      return { 
        success: false, 
        message: 'Sending data to hardware requires explicit confirmation. This is a safety measure.'
      };
    }

    if (!this.port || !this.port.isOpen) {
      return { success: false, message: 'Not connected to serial port' };
    }

    return new Promise((resolve) => {
      this.port.write(data, (err) => {
        if (err) {
          resolve({ success: false, message: err.message });
        } else {
          resolve({ success: true, message: 'Data sent' });
        }
      });
    });
  }

  getStatus() {
    return {
      state: this.state,
      port: this.portPath,
      config: this.config,
      bytesReceived: this.bytesReceived,
      packetsReceived: this.packetsReceived,
      lastDataTime: this.lastDataTime,
      hardwareAvailable: !!SerialPort
    };
  }

  getRadioConfig() {
    return { ...this.config };
  }

  updateRadioConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    return { success: true, config: this.config };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SerialInterface, CONNECTION_STATES, DEFAULT_RADIO_CONFIG };
}
if (typeof window !== 'undefined') {
  window.SerialInterface = SerialInterface;
  window.CONNECTION_STATES = CONNECTION_STATES;
  window.DEFAULT_RADIO_CONFIG = DEFAULT_RADIO_CONFIG;
}
