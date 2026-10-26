/**
 * CAN-7USAT Command Processor
 * 
 * Handles ground station commands per competition requirements §6.1.
 * In simulation mode, commands are processed by the simulation engine.
 * In live mode, commands are queued for the radio transport (disabled until configured).
 */

'use strict';

const COMMANDS = {
  START_TELEMETRY: {
    id: 'START_TELEMETRY',
    label: 'Start Telemetry',
    description: 'Command CAN-7USAT to begin transmitting telemetry (§6.1.i)',
    requiresConfirmation: false
  },
  STOP_TELEMETRY: {
    id: 'STOP_TELEMETRY',
    label: 'Stop Telemetry',
    description: 'Command CAN-7USAT to stop transmitting telemetry',
    requiresConfirmation: false
  },
  CALIBRATE_GYRO: {
    id: 'CALIBRATE_GYRO',
    label: 'Calibrate Gyro',
    description: 'Zero gyroscope readings on launch pad (§6.1.vi)',
    requiresConfirmation: false
  },
  ZERO_BAROMETRIC_ALTITUDE: {
    id: 'ZERO_BAROMETRIC_ALTITUDE',
    label: 'Zero Barometric Altitude',
    description: 'Set current altitude as zero reference (§6.1.vi)',
    requiresConfirmation: false
  },
  CALIBRATE_ACCELEROMETER: {
    id: 'CALIBRATE_ACCELEROMETER',
    label: 'Calibrate Accelerometer',
    description: 'Zero accelerometer readings on launch pad (§6.1.vi)',
    requiresConfirmation: false
  },
  REQUEST_STATUS: {
    id: 'REQUEST_STATUS',
    label: 'Request Status',
    description: 'Request current system status from CAN-7USAT',
    requiresConfirmation: false
  },
  REQUEST_CONFIGURATION: {
    id: 'REQUEST_CONFIGURATION',
    label: 'Request Configuration',
    description: 'Request current configuration from CAN-7USAT',
    requiresConfirmation: false
  },
  RESET_SIMULATION: {
    id: 'RESET_SIMULATION',
    label: 'Reset Simulation',
    description: 'Reset the simulation engine to initial state',
    requiresConfirmation: false,
    simulationOnly: true
  },
  INJECT_TEST_FAULT: {
    id: 'INJECT_TEST_FAULT',
    label: 'Inject Test Fault',
    description: 'Inject a simulated fault for testing',
    requiresConfirmation: true,
    simulationOnly: true,
    params: ['faultType']
  }
};

class CommandProcessor {
  constructor(simulationEngine = null) {
    this.simulation = simulationEngine;
    this.mode = 'SIMULATION'; // 'SIMULATION' or 'LIVE'
    this.history = [];
    this.pendingCommands = [];
    this.commandCounter = 0;
    this.listeners = [];
  }

  setSimulation(engine) {
    this.simulation = engine;
  }

  setMode(mode) {
    this.mode = mode;
  }

  onEvent(callback) {
    this.listeners.push(callback);
  }

  _emit(event) {
    this.listeners.forEach(cb => cb(event));
  }

  /**
   * Execute a command
   * @param {string} commandId - Command identifier
   * @param {Object} params - Command parameters
   * @param {boolean} confirmed - Whether user has confirmed (for dangerous commands)
   * @returns {Object} Command result
   */
  execute(commandId, params = {}, confirmed = false) {
    const cmdDef = COMMANDS[commandId];
    if (!cmdDef) {
      const result = this._makeResult(commandId, 'REJECTED', `Unknown command: ${commandId}`);
      this.history.push(result);
      return result;
    }

    // Check if command requires confirmation
    if (cmdDef.requiresConfirmation && !confirmed) {
      const result = this._makeResult(commandId, 'AWAITING_CONFIRMATION', 
        'This command requires confirmation before execution.');
      this.history.push(result);
      return result;
    }

    // Check simulation-only commands in live mode
    if (cmdDef.simulationOnly && this.mode === 'LIVE') {
      const result = this._makeResult(commandId, 'REJECTED', 
        'This command is only available in simulation mode.');
      this.history.push(result);
      return result;
    }

    // Execute based on mode
    if (this.mode === 'SIMULATION') {
      return this._executeSimulation(commandId, params);
    } else {
      return this._executeLive(commandId, params);
    }
  }

  _executeSimulation(commandId, params) {
    if (!this.simulation) {
      const result = this._makeResult(commandId, 'ERROR', 'Simulation engine not available');
      this.history.push(result);
      return result;
    }

    let response;
    switch (commandId) {
      case 'START_TELEMETRY':
        response = this.simulation.startTelemetry();
        break;
      case 'STOP_TELEMETRY':
        response = this.simulation.stopTelemetry();
        break;
      case 'CALIBRATE_GYRO':
        response = this.simulation.calibrateGyro();
        break;
      case 'ZERO_BAROMETRIC_ALTITUDE':
        response = this.simulation.calibrateBarometricAltitude();
        break;
      case 'CALIBRATE_ACCELEROMETER':
        response = this.simulation.calibrateAccelerometer();
        break;
      case 'REQUEST_STATUS':
        response = { success: true, message: 'Status', data: this.simulation.getStatus() };
        break;
      case 'REQUEST_CONFIGURATION':
        response = { success: true, message: 'Configuration', data: this.simulation.config };
        break;
      case 'RESET_SIMULATION':
        this.simulation.reset();
        response = { success: true, message: 'Simulation reset to initial state' };
        break;
      case 'INJECT_TEST_FAULT':
        response = this.simulation.injectFault(params.faultType);
        break;
      default:
        response = { success: false, message: `Unhandled command: ${commandId}` };
    }

    const status = response.success ? 'ACKNOWLEDGED' : 'ERROR';
    const result = this._makeResult(commandId, status, response.message, response.data);
    this.history.push(result);
    this._emit({ type: 'COMMAND_RESULT', command: result });
    return result;
  }

  _executeLive(commandId, params) {
    // Live radio transport is disabled until explicitly configured
    const result = this._makeResult(commandId, 'PENDING',
      'Live radio transport not configured. Connect a serial radio adapter and configure the command protocol.');
    this.history.push(result);
    this._emit({ type: 'COMMAND_RESULT', command: result });
    return result;
  }

  _makeResult(commandId, status, message, data = null) {
    return {
      id: ++this.commandCounter,
      commandId,
      label: COMMANDS[commandId]?.label || commandId,
      status,
      message,
      data,
      timestamp: new Date().toISOString(),
      mode: this.mode
    };
  }

  getHistory() {
    return this.history;
  }

  clearHistory() {
    this.history = [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CommandProcessor, COMMANDS };
}
if (typeof window !== 'undefined') {
  window.CommandProcessor = CommandProcessor;
  window.COMMANDS = COMMANDS;
}
