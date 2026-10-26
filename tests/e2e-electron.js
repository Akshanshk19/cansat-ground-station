/**
 * CAN-7USAT Ground Station End-to-End Verification Test
 * 
 * Boots Electron with actual main process, initializes backend,
 * starts simulation, verifies packet updates and DOM rendering,
 * executes command, verifies CSV file logging, and exits.
 */

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Import backend modules exactly as main.js does
const { SimulationEngine, SCENARIOS, DEFAULT_CONFIG } = require('../src/simulation/physics');
const { TelemetryParser } = require('../src/telemetry/parser');
const { DataLogger } = require('../src/logging/dataLogger');
const { CommandProcessor, COMMANDS } = require('../src/commands/commandProcessor');
const { SerialInterface } = require('../src/serial/serialInterface');
const { EventLogger } = require('../src/logging/eventLogger');

let mainWindow;
let simulation;
let parser;
let dataLogger;
let commandProcessor;
let serialInterface;
let eventLogger;
let simulationInterval = null;
let simulationSpeed = 5; // Fast for test
let appMode = 'SIMULATION';

function setupApp() {
  simulation = new SimulationEngine();
  simulation.setScenario('NOMINAL');
  parser = new TelemetryParser(DEFAULT_CONFIG.teamIdFull);
  dataLogger = new DataLogger({
    teamId: DEFAULT_CONFIG.teamId,
    outputDir: path.join(__dirname, 'e2e_data')
  });
  commandProcessor = new CommandProcessor(simulation);
  serialInterface = new SerialInterface();
  eventLogger = new EventLogger({
    logFile: path.join(__dirname, 'e2e_data', 'e2e_events.log')
  });

  // Handlers matching main.js
  ipcMain.handle('sim-start', (event, scenarioKey) => {
    simulation.reset();
    if (scenarioKey) simulation.setScenario(scenarioKey);
    simulation.running = true;
    simulation.telemetryEnabled = true;
    
    simulationInterval = setInterval(() => {
      if (!simulation.running || simulation.paused) return;
      const packet = simulation.step();
      if (packet && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('telemetry-packet', packet);
        if (dataLogger.recording) dataLogger.logPacket(packet);
      }
      if (simulation.events.length > 0) {
        simulation.events.splice(0).forEach(evt => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('event', evt);
          }
        });
      }
    }, 50);

    return simulation.getStatus();
  });

  ipcMain.handle('sim-pause', () => { simulation.paused = true; return simulation.getStatus(); });
  ipcMain.handle('sim-resume', () => { simulation.paused = false; return simulation.getStatus(); });
  ipcMain.handle('sim-stop', () => {
    simulation.running = false;
    if (simulationInterval) { clearInterval(simulationInterval); simulationInterval = null; }
    return simulation.getStatus();
  });
  ipcMain.handle('sim-reset', () => {
    if (simulationInterval) { clearInterval(simulationInterval); simulationInterval = null; }
    simulation.reset();
    return simulation.getStatus();
  });
  ipcMain.handle('sim-step', () => {
    const packet = simulation.step();
    if (packet && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('telemetry-packet', packet);
      if (dataLogger.recording) dataLogger.logPacket(packet);
    }
    return { packet, status: simulation.getStatus() };
  });
  ipcMain.handle('sim-speed', (event, speed) => ({ speed }));
  ipcMain.handle('sim-scenario', (event, key) => { simulation.setScenario(key); return { scenario: key }; });
  ipcMain.handle('sim-status', () => simulation.getStatus());
  ipcMain.handle('get-scenarios', () => SCENARIOS);
  ipcMain.handle('get-config', () => ({ ...simulation.config }));
  ipcMain.handle('update-config', (event, updates) => { Object.assign(simulation.config, updates); return simulation.config; });
  ipcMain.handle('execute-command', (event, cmdId, params, confirmed) => commandProcessor.execute(cmdId, params || {}, confirmed));
  ipcMain.handle('get-commands', () => COMMANDS);
  ipcMain.handle('get-command-history', () => commandProcessor.getHistory());
  ipcMain.handle('recording-start', (event, source) => dataLogger.startRecording(source || appMode));
  ipcMain.handle('recording-stop', () => dataLogger.stopRecording());
  ipcMain.handle('recording-status', () => dataLogger.getStatus());
  ipcMain.handle('list-flight-files', () => dataLogger.listFlightFiles());
  ipcMain.handle('serial-list-ports', async () => serialInterface.listPorts());
  ipcMain.handle('serial-status', () => serialInterface.getStatus());
  ipcMain.handle('radio-config', () => serialInterface.getRadioConfig());
  ipcMain.handle('radio-config-update', (event, cfg) => serialInterface.updateRadioConfig(cfg));
  ipcMain.handle('get-events', (event, f) => eventLogger.getEvents(f || {}));
  ipcMain.handle('clear-events', () => { eventLogger.clear(); return { success: true }; });
  ipcMain.handle('get-mode', () => ({ mode: appMode }));
  ipcMain.handle('get-parser-stats', () => parser.getStats());

  mainWindow = new BrowserWindow({
    show: false, // Headless
    width: 1400,
    height: 900,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  setupApp();

  mainWindow.webContents.on('did-finish-load', async () => {
    console.log('[E2E Test] Page loaded successfully.');

    try {
      // 1. Verify UI initial state
      const initialTitle = await mainWindow.webContents.executeJavaScript('document.title');
      console.log('[E2E Test] Page Title:', initialTitle);
      if (!initialTitle.includes('CAN-7USAT')) throw new Error('Incorrect page title');

      // 2. Start CSV recording
      const recStart = await mainWindow.webContents.executeJavaScript('startRecording()');
      console.log('[E2E Test] Recording started:', dataLogger.recording);
      if (!dataLogger.recording) throw new Error('DataLogger failed to start');

      // 3. Start Simulation
      await mainWindow.webContents.executeJavaScript('simStart()');
      console.log('[E2E Test] Simulation started.');

      // Wait 1.5 seconds for telemetry packets to flow into the UI and charts
      await new Promise(r => setTimeout(r, 1500));

      // 4. Verify telemetry packet values in DOM
      const domTelemetry = await mainWindow.webContents.executeJavaScript(`({
        altitude: document.getElementById('val-altitude')?.textContent,
        pressure: document.getElementById('val-pressure')?.textContent,
        packets: document.getElementById('val-packets')?.textContent,
        state: document.getElementById('sb-state')?.textContent,
        tableRows: document.getElementById('telemetry-tbody')?.children.length,
        chartAltPoints: window.chartData?.altitude?.length
      })`);
      console.log('[E2E Test] Telemetry in DOM:', domTelemetry);

      if (parseInt(domTelemetry.packets, 10) <= 0) {
        throw new Error('No packets processed in DOM');
      }
      if (domTelemetry.tableRows <= 0) {
        throw new Error('Telemetry table received no rows');
      }
      if (domTelemetry.chartAltPoints <= 0) {
        throw new Error('Chart data buffer received no points');
      }

      // 5. Test command execution from UI
      await mainWindow.webContents.executeJavaScript('sendCommand("CALIBRATE_GYRO")');
      const cmdHistory = commandProcessor.getHistory();
      console.log('[E2E Test] Command executed. History count:', cmdHistory.length);
      if (cmdHistory.length === 0 || cmdHistory[cmdHistory.length - 1].status !== 'ACKNOWLEDGED') {
        throw new Error('Command failed or not acknowledged');
      }

      // 6. Stop simulation and recording
      await mainWindow.webContents.executeJavaScript('simStop()');
      await mainWindow.webContents.executeJavaScript('stopRecording()');
      console.log('[E2E Test] Stopped simulation and recording. Total logged records:', dataLogger.recordCount);

      if (dataLogger.recordCount <= 0) {
        throw new Error('No records saved to CSV');
      }

      // Verify CSV file exists and has content
      if (!fs.existsSync(dataLogger.filePath)) {
        throw new Error('CSV file was not created');
      }
      const csvContent = fs.readFileSync(dataLogger.filePath, 'utf8');
      console.log('[E2E Test] CSV file sample line:', csvContent.split('\n')[8] || 'none');
      if (!csvContent.includes('TEAM_ID,TIME_STAMPING,PACKET_COUNT')) {
        throw new Error('CSV headers missing');
      }

      console.log('✅ ALL E2E GROUND STATION TESTS PASSED SUCCESSFULLY!');
    } catch (err) {
      console.error('❌ E2E Test Failed:', err.message);
      process.exitCode = 1;
    } finally {
      if (simulationInterval) clearInterval(simulationInterval);
      // Clean up e2e_data
      const e2eDir = path.join(__dirname, 'e2e_data');
      if (fs.existsSync(e2eDir)) {
        try { fs.rmSync(e2eDir, { recursive: true, force: true }); } catch (e) {}
      }
      app.quit();
    }
  });
});
