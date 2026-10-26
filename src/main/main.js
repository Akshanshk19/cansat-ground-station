/**
 * CAN-7USAT Ground Station - Electron Main Process
 * 
 * IN-SPACe CAN-7USAT India Student Competition 2026
 * Team 038
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { SimulationEngine, SCENARIOS, STATE_LABELS, DEFAULT_CONFIG } = require('../simulation/physics');
const { TelemetryParser } = require('../telemetry/parser');
const { DataLogger } = require('../logging/dataLogger');
const { CommandProcessor, COMMANDS } = require('../commands/commandProcessor');
const { SerialInterface, DEFAULT_RADIO_CONFIG, CONNECTION_STATES } = require('../serial/serialInterface');
const { EventLogger } = require('../logging/eventLogger');

let mainWindow;
let simulation;
let parser;
let dataLogger;
let commandProcessor;
let serialInterface;
let eventLogger;
let simulationInterval = null;
let simulationSpeed = 1;
let appMode = 'SIMULATION'; // 'SIMULATION' or 'LIVE'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    title: 'CAN-7USAT Ground Station — Team 038',
    backgroundColor: '#0a0e1a',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  
  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function initializeBackend() {
  // Initialize simulation
  simulation = new SimulationEngine();
  simulation.setScenario('NOMINAL');

  // Initialize parser
  parser = new TelemetryParser(DEFAULT_CONFIG.teamIdFull);

  // Initialize data logger
  dataLogger = new DataLogger({ 
    teamId: DEFAULT_CONFIG.teamId,
    outputDir: path.join(process.cwd(), 'data')
  });

  // Initialize command processor
  commandProcessor = new CommandProcessor(simulation);

  // Initialize serial interface  
  serialInterface = new SerialInterface();

  // Initialize event logger
  eventLogger = new EventLogger({
    logFile: path.join(process.cwd(), 'data', 'events.log')
  });

  eventLogger.log('APP', 'Ground station application started');
  eventLogger.log('APP', `Mode: ${appMode}`);

  // Wire serial data to parser
  serialInterface.onData((event) => {
    if (event.type === 'packet' && appMode === 'LIVE') {
      const packets = parser.feed(event.data + '\r');
      packets.forEach(pkt => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('telemetry-packet', pkt);
        }
        dataLogger.logPacket(pkt);
      });
    }
  });
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────

function setupIPC() {
  // ─── Simulation Controls ────────────────────────────────────────────
  ipcMain.handle('sim-start', (event, scenarioKey) => {
    simulation.reset();
    if (scenarioKey) simulation.setScenario(scenarioKey);
    simulation.running = true;
    simulation.telemetryEnabled = true;
    
    const interval = Math.floor(1000 / (simulation.config.sampleRateHz * simulationSpeed));
    
    if (simulationInterval) clearInterval(simulationInterval);
    simulationInterval = setInterval(() => {
      if (!simulation.running || simulation.paused) return;
      
      const packet = simulation.step();
      if (packet && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('telemetry-packet', packet);
        if (dataLogger.recording) {
          dataLogger.logPacket(packet);
        }
      }
      
      // Send simulation events
      if (simulation.events.length > 0) {
        const newEvents = simulation.events.splice(0);
        newEvents.forEach(evt => {
          eventLogger.log(evt.type, evt.message, evt.severity);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('event', evt);
          }
        });
      }

      if (simulation.finished) {
        clearInterval(simulationInterval);
        simulationInterval = null;
        eventLogger.log('SIMULATION', 'Simulation completed');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sim-status', simulation.getStatus());
        }
      }
    }, interval);
    
    eventLogger.log('SIMULATION', `Simulation started: ${scenarioKey || 'NOMINAL'}`);
    return simulation.getStatus();
  });

  ipcMain.handle('sim-pause', () => {
    simulation.paused = true;
    eventLogger.log('SIMULATION', 'Simulation paused');
    return simulation.getStatus();
  });

  ipcMain.handle('sim-resume', () => {
    simulation.paused = false;
    eventLogger.log('SIMULATION', 'Simulation resumed');
    return simulation.getStatus();
  });

  ipcMain.handle('sim-stop', () => {
    simulation.running = false;
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
    eventLogger.log('SIMULATION', 'Simulation stopped');
    return simulation.getStatus();
  });

  ipcMain.handle('sim-reset', () => {
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
    simulation.reset();
    eventLogger.log('SIMULATION', 'Simulation reset');
    return simulation.getStatus();
  });

  ipcMain.handle('sim-step', () => {
    const packet = simulation.step();
    if (packet && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('telemetry-packet', packet);
      if (dataLogger.recording) {
        dataLogger.logPacket(packet);
      }
    }
    return { packet, status: simulation.getStatus() };
  });

  ipcMain.handle('sim-speed', (event, speed) => {
    simulationSpeed = Math.max(0.1, Math.min(10, speed));
    // Restart interval with new speed if running
    if (simulation.running && simulationInterval) {
      clearInterval(simulationInterval);
      const interval = Math.floor(1000 / (simulation.config.sampleRateHz * simulationSpeed));
      simulationInterval = setInterval(() => {
        if (!simulation.running || simulation.paused) return;
        const packet = simulation.step();
        if (packet && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('telemetry-packet', packet);
          if (dataLogger.recording) dataLogger.logPacket(packet);
        }
        if (simulation.events.length > 0) {
          simulation.events.splice(0).forEach(evt => {
            eventLogger.log(evt.type, evt.message, evt.severity);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('event', evt);
            }
          });
        }
        if (simulation.finished) {
          clearInterval(simulationInterval);
          simulationInterval = null;
        }
      }, interval);
    }
    return { speed: simulationSpeed };
  });

  ipcMain.handle('sim-scenario', (event, key) => {
    simulation.setScenario(key);
    return { scenario: key, scenarios: SCENARIOS };
  });

  ipcMain.handle('sim-status', () => {
    return simulation.getStatus();
  });

  ipcMain.handle('get-scenarios', () => {
    return SCENARIOS;
  });

  ipcMain.handle('get-config', () => {
    return { ...simulation.config, radioConfig: serialInterface.getRadioConfig() };
  });

  ipcMain.handle('update-config', (event, updates) => {
    Object.assign(simulation.config, updates);
    return simulation.config;
  });

  // ─── Commands ───────────────────────────────────────────────────────
  ipcMain.handle('execute-command', (event, commandId, params, confirmed) => {
    const result = commandProcessor.execute(commandId, params || {}, confirmed);
    eventLogger.log('COMMAND', `${commandId}: ${result.status} - ${result.message}`);
    return result;
  });

  ipcMain.handle('get-commands', () => {
    return COMMANDS;
  });

  ipcMain.handle('get-command-history', () => {
    return commandProcessor.getHistory();
  });

  // ─── Data Logger ────────────────────────────────────────────────────
  ipcMain.handle('recording-start', (event, source) => {
    const result = dataLogger.startRecording(source || appMode);
    if (result.success) {
      eventLogger.log('RECORDING', `Recording started: ${result.filePath}`);
    }
    return result;
  });

  ipcMain.handle('recording-stop', async () => {
    const result = await dataLogger.stopRecording();
    if (result.success) {
      eventLogger.log('RECORDING', `Recording stopped. ${result.recordCount} records saved to ${result.filePath}`);
    }
    return result;
  });

  ipcMain.handle('recording-status', () => {
    return dataLogger.getStatus();
  });

  ipcMain.handle('list-flight-files', () => {
    return dataLogger.listFlightFiles();
  });

  ipcMain.handle('select-output-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Output Directory'
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return dataLogger.setOutputDir(result.filePaths[0]);
    }
    return { success: false, message: 'Cancelled' };
  });

  // ─── Serial Interface ──────────────────────────────────────────────
  ipcMain.handle('serial-list-ports', async () => {
    return await serialInterface.listPorts();
  });

  ipcMain.handle('serial-connect', async (event, portPath, options) => {
    const result = await serialInterface.connect(portPath, options);
    if (result.success) {
      appMode = 'LIVE';
      commandProcessor.setMode('LIVE');
      eventLogger.log('CONNECTION', `Connected to ${portPath}`);
    }
    return result;
  });

  ipcMain.handle('serial-disconnect', async () => {
    const result = await serialInterface.disconnect();
    appMode = 'SIMULATION';
    commandProcessor.setMode('SIMULATION');
    eventLogger.log('CONNECTION', 'Disconnected from serial port');
    return result;
  });

  ipcMain.handle('serial-status', () => {
    return serialInterface.getStatus();
  });

  ipcMain.handle('radio-config', () => {
    return serialInterface.getRadioConfig();
  });

  ipcMain.handle('radio-config-update', (event, config) => {
    return serialInterface.updateRadioConfig(config);
  });

  // ─── Event Log ──────────────────────────────────────────────────────
  ipcMain.handle('get-events', (event, filters) => {
    return eventLogger.getEvents(filters || {});
  });

  ipcMain.handle('clear-events', () => {
    eventLogger.clear();
    return { success: true };
  });

  // ─── App Mode ───────────────────────────────────────────────────────
  ipcMain.handle('get-mode', () => {
    return { mode: appMode };
  });

  ipcMain.handle('get-parser-stats', () => {
    return parser.getStats();
  });
}

// ─── App Lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(() => {
  initializeBackend();
  setupIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  if (simulationInterval) clearInterval(simulationInterval);
  if (eventLogger) eventLogger.close();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
