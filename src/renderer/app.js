/**
 * CAN-7USAT Ground Station — Renderer Application
 * 
 * IN-SPACe CAN-7USAT India Student Competition 2026 — Team 038
 * 
 * This file manages all UI updates, chart rendering, map display,
 * navigation, and IPC communication with the main process.
 */

'use strict';

const { ipcRenderer } = require('electron');
const Chart = window.Chart || (typeof require !== 'undefined' ? require('chart.js/auto') : null);
const L = window.L || (typeof require !== 'undefined' ? require('leaflet') : null);

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

const STATE_LABELS = {
  0: 'BOOT', 1: 'TEST_MODE', 2: 'LAUNCH_PAD', 3: 'ASCENT',
  4: 'ROCKET_DEPLOY', 5: 'DESCENT', 6: 'AEROBREAK_RELEASE', 7: 'IMPACT'
};
const STATE_CLASSES = {
  0: 'state-boot', 1: 'state-test_mode', 2: 'state-launch_pad', 3: 'state-ascent',
  4: 'state-rocket_deploy', 5: 'state-descent', 6: 'state-aerobreak_release', 7: 'state-impact'
};

let currentPage = 'dashboard';
let chartsPaused = false;
let chartWindowSize = 300; // seconds
let selectedScenario = 'NOMINAL';
let lastPacketTime = 0;
let packetRateCounter = 0;
let packetRateValue = 0;
let packetRateInterval = null;
let telemetryRows = [];
const MAX_TABLE_ROWS = 500;
const MAX_CHART_POINTS = 600;
let events = [];
let mapInitialized = false;
let map = null;
let mapMarker = null;
let mapPath = null;
let mapPathCoords = [];
let mapStartMarker = null;
let mapGSMarker = null;

// Chart data buffers
const chartData = {
  altitude: [], gnssAlt: [], velocity: [], pressure: [],
  temperature: [], voltage: [], roll: [], pitch: [], yaw: [],
  accelX: [], accelY: [], accelZ: [], gyro: [], sats: [],
  timestamps: []
};

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    navigateTo(page);
  });
});

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  
  const pageEl = document.getElementById(`page-${page}`);
  const navBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  
  if (pageEl) pageEl.classList.add('active');
  if (navBtn) navBtn.classList.add('active');
  currentPage = page;

  // Lazy init
  if (page === 'map' && !mapInitialized) initMap();
  if (page === 'simulation') loadScenarios();
  if (page === 'events') refreshEvents();
  if (page === 'logger') { refreshRecordingStatus(); refreshFlightFiles(); }
  if (page === 'radio') refreshPorts();
  if (page === 'settings') loadDiagnostics();
}

// ═══════════════════════════════════════════════════════════════════════════
// TELEMETRY PACKET HANDLER
// ═══════════════════════════════════════════════════════════════════════════

ipcRenderer.on('telemetry-packet', (event, packet) => {
  if (!packet) return;
  
  lastPacketTime = Date.now();
  packetRateCounter++;
  
  updateDashboard(packet);
  updateTelemetryTable(packet);
  updateCharts(packet);
  updateMap(packet);
  updateStatusBar(packet);
});

ipcRenderer.on('event', (event, evt) => {
  events.push(evt);
  if (events.length > 2000) events = events.slice(-1000);
  addDashEventEntry(evt);
  if (currentPage === 'events') addEventEntry(evt);
});

ipcRenderer.on('sim-status', (event, status) => {
  updateSimStatus(status);
});

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD UPDATES
// ═══════════════════════════════════════════════════════════════════════════

function updateDashboard(p) {
  const simLabel = p.isSimulated ? 'SIM' : 'LIVE';

  // Values
  setText('val-altitude', p.altitude.toFixed(1));
  setText('val-gnss-alt', p.gnssAltitude.toFixed(1));
  setText('val-velocity', p.verticalVelocity !== null ? p.verticalVelocity.toFixed(1) : '—');
  setText('val-pressure', p.pressure);
  setText('val-temp', p.temperature.toFixed(1));
  setText('val-voltage', p.voltage.toFixed(2));
  setText('val-lat', p.gnssLatitude.toFixed(4));
  setText('val-lon', p.gnssLongitude.toFixed(4));
  setText('val-sats', p.gnssSats);
  setText('val-rpy', `${p.roll.toFixed(1)} / ${p.pitch.toFixed(1)} / ${p.yaw.toFixed(1)}`);
  setText('val-accel', `${p.accelX.toFixed(2)} / ${p.accelY.toFixed(2)} / ${p.accelZ.toFixed(2)}`);
  setText('val-gyro', p.gyroSpinRate.toFixed(1));
  setText('val-packets', p.packetCount);
  setText('val-met', p.missionTime.toFixed(1));
  setText('val-update-rate', packetRateValue.toFixed(1));
  setText('val-link', p.isSimulated ? 'SIMULATED' : 'LIVE');

  // Status labels
  const setStatus = (id, label) => { const el = document.getElementById(id); if (el) el.textContent = simLabel; };
  ['stat-altitude','stat-gnss-alt','stat-velocity','stat-pressure','stat-temp','stat-voltage',
   'stat-lat','stat-lon','stat-sats','stat-rpy','stat-accel','stat-gyro','stat-packets','stat-met',
   'stat-update-rate','stat-link'].forEach(id => setStatus(id, simLabel));

  // Add simulated class
  document.querySelectorAll('.tcard').forEach(c => {
    if (p.isSimulated) c.classList.add('tcard-simulated');
    else c.classList.remove('tcard-simulated');
  });

  // Battery warning
  const voltCard = document.getElementById('card-voltage');
  if (voltCard) {
    voltCard.classList.remove('tcard-warning', 'tcard-error');
    if (p.voltage < 6.5) voltCard.classList.add('tcard-error');
    else if (p.voltage < 7.0) voltCard.classList.add('tcard-warning');
  }

  // GNSS sat warning
  const satCard = document.getElementById('card-sats');
  if (satCard) {
    satCard.classList.remove('tcard-warning', 'tcard-error');
    if (p.gnssSats < 3) satCard.classList.add('tcard-error');
    else if (p.gnssSats < 5) satCard.classList.add('tcard-warning');
  }

  // Flight state banner
  const stateLabel = STATE_LABELS[p.flightState] || 'UNKNOWN';
  const stateClass = STATE_CLASSES[p.flightState] || 'state-boot';
  
  const banner = document.getElementById('flight-state-banner');
  if (banner) {
    banner.className = `state-banner ${stateClass}`;
  }
  setText('state-name', stateLabel);
  setText('state-time', `T+ ${p.missionTime.toFixed(1)} s`);
  setText('state-source', p.isSimulated ? 'SIMULATED' : 'LIVE DATA');
}

function updateStatusBar(p) {
  const stateLabel = STATE_LABELS[p.flightState] || 'UNKNOWN';
  setText('sb-state', stateLabel);
  const sbState = document.getElementById('sb-state');
  if (sbState) {
    sbState.style.color = getStateColor(p.flightState);
    sbState.style.borderColor = getStateColor(p.flightState);
  }
  setText('sb-met', `T+ ${p.missionTime.toFixed(1)} s`);
  setText('sb-packets', `PKT: ${p.packetCount}`);
  setText('sb-packet-rate', `${packetRateValue.toFixed(0)} pkt/s`);
}

function getStateColor(state) {
  const colors = {
    0: '#64748b', 1: '#06b6d4', 2: '#3b82f6', 3: '#f97316',
    4: '#eab308', 5: '#22c55e', 6: '#a855f7', 7: '#ef4444'
  };
  return colors[state] || '#64748b';
}

// ═══════════════════════════════════════════════════════════════════════════
// TELEMETRY TABLE
// ═══════════════════════════════════════════════════════════════════════════

function updateTelemetryTable(p) {
  const tbody = document.getElementById('telemetry-tbody');
  if (!tbody) return;
  
  const stateLabel = STATE_LABELS[p.flightState] || String(p.flightState);
  
  const row = document.createElement('tr');
  row.innerHTML = `
    <td>${p.missionTime.toFixed(1)}</td>
    <td>${p.packetCount}</td>
    <td>${p.altitude.toFixed(1)}</td>
    <td>${p.pressure}</td>
    <td>${p.temperature.toFixed(1)}</td>
    <td>${p.voltage.toFixed(2)}</td>
    <td>${p.gnssLatitude.toFixed(4)}</td>
    <td>${p.gnssLongitude.toFixed(4)}</td>
    <td>${p.gnssAltitude.toFixed(1)}</td>
    <td>${p.gnssSats}</td>
    <td style="font-size:9px">${p.accelX.toFixed(1)}/${p.accelY.toFixed(1)}/${p.accelZ.toFixed(1)}</td>
    <td>${p.gyroSpinRate.toFixed(1)}</td>
    <td style="color:${getStateColor(p.flightState)}">${stateLabel}</td>
  `;
  
  tbody.insertBefore(row, tbody.firstChild);
  
  // Keep table bounded
  while (tbody.children.length > MAX_TABLE_ROWS) {
    tbody.removeChild(tbody.lastChild);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════════════════════

let charts = {};

function initCharts() {
  const defaultOpts = (title, yLabel, color) => ({
    type: 'line',
    data: { labels: [], datasets: [{ label: title, data: [], borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { display: true, title: { display: true, text: 'Time (s)', color: '#64748b', font: { size: 10 } }, ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 10 }, grid: { color: 'rgba(30,41,59,0.5)' } },
        y: { display: true, title: { display: true, text: yLabel, color: '#64748b', font: { size: 10 } }, ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(30,41,59,0.5)' } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false, backgroundColor: 'rgba(10,14,26,0.9)', titleColor: '#e2e8f0', bodyColor: '#94a3b8', borderColor: '#1e293b', borderWidth: 1 }
      }
    }
  });

  const multiOpts = (title, yLabel, datasets) => ({
    type: 'line',
    data: { labels: [], datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { display: true, title: { display: true, text: 'Time (s)', color: '#64748b', font: { size: 10 } }, ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 10 }, grid: { color: 'rgba(30,41,59,0.5)' } },
        y: { display: true, title: { display: true, text: yLabel, color: '#64748b', font: { size: 10 } }, ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(30,41,59,0.5)' } }
      },
      plugins: {
        legend: { display: true, labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 } },
        tooltip: { mode: 'index', intersect: false, backgroundColor: 'rgba(10,14,26,0.9)', titleColor: '#e2e8f0', bodyColor: '#94a3b8' }
      }
    }
  });

  charts.altitude = new Chart(document.getElementById('chart-altitude'), defaultOpts('Relative Altitude', 'Altitude (m)', '#3b82f6'));
  charts.gnssAlt = new Chart(document.getElementById('chart-gnss-alt'), defaultOpts('GNSS Altitude', 'Altitude (m ASL)', '#06b6d4'));
  charts.velocity = new Chart(document.getElementById('chart-velocity'), defaultOpts('Vertical Velocity', 'Velocity (m/s)', '#f97316'));
  charts.pressure = new Chart(document.getElementById('chart-pressure'), defaultOpts('Pressure', 'Pressure (Pa)', '#a855f7'));
  charts.temperature = new Chart(document.getElementById('chart-temperature'), defaultOpts('Temperature', 'Temp (°C)', '#ef4444'));
  charts.voltage = new Chart(document.getElementById('chart-voltage'), defaultOpts('Battery Voltage', 'Voltage (V)', '#22c55e'));
  charts.gyro = new Chart(document.getElementById('chart-gyro'), defaultOpts('Gyro Spin Rate', 'Rate (°/s)', '#eab308'));
  charts.sats = new Chart(document.getElementById('chart-sats'), defaultOpts('GNSS Satellites', 'Count', '#06b6d4'));

  charts.rpy = new Chart(document.getElementById('chart-rpy'), multiOpts('Orientation', 'Angle (°)', [
    { label: 'Roll', data: [], borderColor: '#3b82f6', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false },
    { label: 'Pitch', data: [], borderColor: '#22c55e', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false },
    { label: 'Yaw', data: [], borderColor: '#f97316', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false }
  ]));

  charts.accel = new Chart(document.getElementById('chart-accel'), multiOpts('Acceleration', 'Accel (m/s²)', [
    { label: 'X', data: [], borderColor: '#ef4444', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false },
    { label: 'Y', data: [], borderColor: '#22c55e', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false },
    { label: 'Z', data: [], borderColor: '#3b82f6', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false }
  ]));
}

function updateCharts(p) {
  if (chartsPaused) return;

  const t = p.missionTime;
  chartData.timestamps.push(t);
  chartData.altitude.push(p.altitude);
  chartData.gnssAlt.push(p.gnssAltitude);
  chartData.velocity.push(p.verticalVelocity);
  chartData.pressure.push(p.pressure);
  chartData.temperature.push(p.temperature);
  chartData.voltage.push(p.voltage);
  chartData.roll.push(p.roll);
  chartData.pitch.push(p.pitch);
  chartData.yaw.push(p.yaw);
  chartData.accelX.push(p.accelX);
  chartData.accelY.push(p.accelY);
  chartData.accelZ.push(p.accelZ);
  chartData.gyro.push(p.gyroSpinRate);
  chartData.sats.push(p.gnssSats);

  // Trim to window
  const maxPts = chartWindowSize > 0 ? Math.min(chartWindowSize, MAX_CHART_POINTS) : MAX_CHART_POINTS;
  for (const key of Object.keys(chartData)) {
    if (chartData[key].length > maxPts) {
      chartData[key] = chartData[key].slice(-maxPts);
    }
  }

  // Update only if charts page is active (performance)
  if (currentPage === 'charts') {
    renderCharts();
  }
}

function renderCharts() {
  const labels = chartData.timestamps;
  
  updateSingleChart(charts.altitude, labels, chartData.altitude);
  updateSingleChart(charts.gnssAlt, labels, chartData.gnssAlt);
  updateSingleChart(charts.velocity, labels, chartData.velocity);
  updateSingleChart(charts.pressure, labels, chartData.pressure);
  updateSingleChart(charts.temperature, labels, chartData.temperature);
  updateSingleChart(charts.voltage, labels, chartData.voltage);
  updateSingleChart(charts.gyro, labels, chartData.gyro);
  updateSingleChart(charts.sats, labels, chartData.sats);

  // Multi-series
  charts.rpy.data.labels = labels;
  charts.rpy.data.datasets[0].data = chartData.roll;
  charts.rpy.data.datasets[1].data = chartData.pitch;
  charts.rpy.data.datasets[2].data = chartData.yaw;
  charts.rpy.update('none');

  charts.accel.data.labels = labels;
  charts.accel.data.datasets[0].data = chartData.accelX;
  charts.accel.data.datasets[1].data = chartData.accelY;
  charts.accel.data.datasets[2].data = chartData.accelZ;
  charts.accel.update('none');
}

function updateSingleChart(chart, labels, data) {
  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update('none');
}

function clearCharts() {
  for (const key of Object.keys(chartData)) {
    chartData[key] = [];
  }
  if (charts.altitude) renderCharts();
}

function toggleChartPause() {
  chartsPaused = !chartsPaused;
}

function setChartWindow(val) {
  chartWindowSize = parseInt(val) || 300;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════════════════════════════════════

function initMap() {
  try {
    map = L.map('map-view').setView([26.7412, 83.8894], 14);
    
    // Try online tiles, fallback to simple grid
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      errorTileUrl: ''
    }).addTo(map);

    // Ground station marker
    mapGSMarker = L.circleMarker([26.7412, 83.8894], {
      radius: 8, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.7
    }).addTo(map).bindPopup('Ground Station (configured reference)');

    mapPath = L.polyline([], { color: '#06b6d4', weight: 2, opacity: 0.8 }).addTo(map);

    mapInitialized = true;
  } catch (err) {
    document.getElementById('map-view').innerHTML = '<div style="padding:40px;color:#64748b;text-align:center">Map unavailable. Check network connectivity for tile loading.</div>';
  }
}

function updateMap(p) {
  if (!mapInitialized || !map) return;
  
  const lat = p.gnssLatitude;
  const lon = p.gnssLongitude;
  
  if (lat === 0 && lon === 0) return; // Skip zero coords

  mapPathCoords.push([lat, lon]);
  
  // Keep path bounded
  if (mapPathCoords.length > 2000) {
    mapPathCoords = mapPathCoords.slice(-1000);
  }
  
  if (mapPath) mapPath.setLatLngs(mapPathCoords);

  if (mapMarker) {
    mapMarker.setLatLng([lat, lon]);
  } else {
    mapMarker = L.circleMarker([lat, lon], {
      radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1
    }).addTo(map).bindPopup('CAN-7USAT Position (simulated)');
  }

  // Set start marker on first point
  if (!mapStartMarker && mapPathCoords.length === 1) {
    mapStartMarker = L.circleMarker([lat, lon], {
      radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.8
    }).addTo(map).bindPopup('Launch/Start Position');
  }

  setText('map-pos', `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`);
  setText('map-points', mapPathCoords.length);

  // Pan to current position periodically
  if (mapPathCoords.length % 10 === 0) {
    map.panTo([lat, lon], { animate: true, duration: 0.5 });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SIMULATION CONTROLS
// ═══════════════════════════════════════════════════════════════════════════

async function simStart() {
  const result = await ipcRenderer.invoke('sim-start', selectedScenario);
  updateSimStatus(result);
  updateSimButtons(true, false);
  document.getElementById('btn-quick-start').disabled = true;
  document.getElementById('btn-quick-pause').disabled = false;
}

async function simPause() {
  const result = await ipcRenderer.invoke('sim-pause');
  updateSimStatus(result);
  updateSimButtons(true, true);
}

async function simResume() {
  const result = await ipcRenderer.invoke('sim-resume');
  updateSimStatus(result);
  updateSimButtons(true, false);
}

async function simStop() {
  const result = await ipcRenderer.invoke('sim-stop');
  updateSimStatus(result);
  updateSimButtons(false, false);
  document.getElementById('btn-quick-start').disabled = false;
  document.getElementById('btn-quick-pause').disabled = true;
}

async function simReset() {
  const result = await ipcRenderer.invoke('sim-reset');
  updateSimStatus(result);
  updateSimButtons(false, false);
  clearCharts();
  clearTelemetryTable();
  resetMap();
  document.getElementById('btn-quick-start').disabled = false;
  document.getElementById('btn-quick-pause').disabled = true;
}

async function simStep() {
  const result = await ipcRenderer.invoke('sim-step');
  if (result.status) updateSimStatus(result.status);
}

async function setSimSpeed(val) {
  const speed = parseFloat(val);
  setText('sim-speed-value', speed.toFixed(1));
  await ipcRenderer.invoke('sim-speed', speed);
}

function quickStart() { simStart(); }
function quickPause() {
  const btn = document.getElementById('btn-quick-pause');
  if (btn.textContent.includes('Pause')) {
    simPause();
    btn.textContent = '▶ Resume';
  } else {
    simResume();
    btn.textContent = '⏸ Pause';
  }
}
function quickReset() { simReset(); }

function updateSimButtons(running, paused) {
  const btnStart = document.getElementById('btn-sim-start');
  const btnPause = document.getElementById('btn-sim-pause');
  const btnResume = document.getElementById('btn-sim-resume');
  if (btnStart) btnStart.disabled = running;
  if (btnPause) btnPause.disabled = !running || paused;
  if (btnResume) btnResume.disabled = !running || !paused;
}

function updateSimStatus(status) {
  if (!status) return;
  setText('sim-state', status.running ? (status.paused ? 'PAUSED' : 'RUNNING') : 'STOPPED');
  setText('sim-phase', STATE_LABELS[status.state] || '—');
  setText('sim-time', `${(status.missionTime || 0).toFixed(1)} s`);
  setText('sim-packets', status.packetCount || 0);
  setText('sim-running', status.running ? 'Yes' : 'No');
  setText('sim-finished', status.finished ? 'Yes' : 'No');
}

async function loadScenarios() {
  const scenarios = await ipcRenderer.invoke('get-scenarios');
  const container = document.getElementById('scenario-list');
  if (!container) return;
  container.innerHTML = '';
  
  for (const [key, sc] of Object.entries(scenarios)) {
    const div = document.createElement('div');
    div.className = `scenario-item ${key === selectedScenario ? 'active' : ''}`;
    div.innerHTML = `<div class="scenario-name">${sc.name}</div><div class="scenario-desc">${sc.description}</div>`;
    div.onclick = () => {
      selectedScenario = key;
      document.querySelectorAll('.scenario-item').forEach(s => s.classList.remove('active'));
      div.classList.add('active');
      ipcRenderer.invoke('sim-scenario', key);
    };
    container.appendChild(div);
  }
}

async function applySimConfig() {
  const updates = {
    launchAltitude: parseFloat(document.getElementById('sim-launch-alt').value),
    aerobreakAltitude: parseFloat(document.getElementById('sim-aerobreak-alt').value),
    primaryDescentRate: parseFloat(document.getElementById('sim-descent-rate').value),
    secondaryDescentRate: parseFloat(document.getElementById('sim-secondary-rate').value),
    ascentRate: parseFloat(document.getElementById('sim-ascent-rate').value),
    sampleRateHz: parseInt(document.getElementById('sim-sample-rate').value),
    randomSeed: parseInt(document.getElementById('sim-seed').value),
    groundTemp: parseFloat(document.getElementById('sim-ground-temp').value),
    batteryVoltageStart: parseFloat(document.getElementById('sim-bat-start').value)
  };
  await ipcRenderer.invoke('update-config', updates);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

async function sendCommand(cmdId, params = {}, confirmed = false) {
  const result = await ipcRenderer.invoke('execute-command', cmdId, params, confirmed);
  addCommandEntry(result);
}

function addCommandEntry(result) {
  const container = document.getElementById('cmd-history');
  if (!container) return;
  
  const statusClass = result.status === 'ACKNOWLEDGED' ? 'cmd-entry-ack' : 
                       result.status === 'ERROR' || result.status === 'REJECTED' ? 'cmd-entry-err' : 'cmd-entry-pending';
  
  const div = document.createElement('div');
  div.className = `cmd-entry ${statusClass}`;
  div.innerHTML = `
    <div>
      <strong>${result.label}</strong>
      <div style="font-size:10px;color:#64748b">${result.message}</div>
    </div>
    <div style="text-align:right">
      <div style="color:${result.status === 'ACKNOWLEDGED' ? '#22c55e' : result.status === 'ERROR' ? '#ef4444' : '#eab308'}">${result.status}</div>
      <div style="font-size:9px;color:#64748b">${new Date(result.timestamp).toLocaleTimeString()}</div>
    </div>
  `;
  container.insertBefore(div, container.firstChild);
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA LOGGER
// ═══════════════════════════════════════════════════════════════════════════

async function startRecording() {
  const result = await ipcRenderer.invoke('recording-start', 'SIMULATION');
  if (result.success) {
    document.getElementById('btn-rec-start').disabled = true;
    document.getElementById('btn-rec-stop').disabled = false;
    const sbRec = document.getElementById('sb-recording');
    sbRec.className = 'sb-badge badge-recording';
    sbRec.textContent = '⏺ RECORDING';
  }
  refreshRecordingStatus();
}

async function stopRecording() {
  const result = await ipcRenderer.invoke('recording-stop');
  document.getElementById('btn-rec-start').disabled = false;
  document.getElementById('btn-rec-stop').disabled = true;
  const sbRec = document.getElementById('sb-recording');
  sbRec.className = 'sb-badge badge-idle';
  sbRec.textContent = 'NOT RECORDING';
  refreshRecordingStatus();
  refreshFlightFiles();
}

async function refreshRecordingStatus() {
  const status = await ipcRenderer.invoke('recording-status');
  setText('logger-state', status.recording ? 'RECORDING' : 'NOT RECORDING');
  const stateEl = document.getElementById('logger-state');
  if (stateEl) stateEl.className = status.recording ? 'badge-recording' : 'badge-idle';
  setText('logger-file', status.filePath || '—');
  setText('logger-records', status.recordCount || 0);
  setText('logger-source', status.source || '—');
}

async function refreshFlightFiles() {
  const files = await ipcRenderer.invoke('list-flight-files');
  const container = document.getElementById('flight-files-list');
  if (!container) return;
  container.innerHTML = '';
  
  if (files.length === 0) {
    container.innerHTML = '<div style="color:#64748b;padding:12px">No flight files found.</div>';
    return;
  }
  
  files.forEach(f => {
    const div = document.createElement('div');
    div.className = 'file-entry';
    div.innerHTML = `
      <span class="file-name">${f.name}</span>
      <span class="file-size">${(f.size / 1024).toFixed(1)} KB — ${new Date(f.modified).toLocaleString()}</span>
    `;
    container.appendChild(div);
  });
}

async function selectOutputDir() {
  const result = await ipcRenderer.invoke('select-output-dir');
  if (result.success) refreshRecordingStatus();
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════════════

async function refreshEvents() {
  const type = document.getElementById('event-filter-type')?.value || '';
  const severity = document.getElementById('event-filter-severity')?.value || '';
  const filters = {};
  if (type) filters.type = type;
  if (severity) filters.severity = severity;
  
  const evts = await ipcRenderer.invoke('get-events', filters);
  const container = document.getElementById('event-log');
  if (!container) return;
  container.innerHTML = '';
  
  evts.slice(-200).reverse().forEach(e => {
    addEventEntryToContainer(container, e);
  });
}

function addEventEntry(evt) {
  const container = document.getElementById('event-log');
  if (container) addEventEntryToContainer(container, evt, true);
}

function addDashEventEntry(evt) {
  const container = document.getElementById('dash-events');
  if (!container) return;
  addEventEntryToContainer(container, evt, true);
  while (container.children.length > 20) {
    container.removeChild(container.lastChild);
  }
}

function addEventEntryToContainer(container, evt, prepend = false) {
  const div = document.createElement('div');
  div.className = `event-entry event-severity-${evt.severity || 'INFO'}`;
  const time = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : `T+${(evt.time || 0).toFixed(1)}s`;
  div.innerHTML = `
    <span class="event-time">${time}</span>
    <span class="event-type">${evt.type}</span>
    <span class="event-severity">${evt.severity || 'INFO'}</span>
    <span class="event-msg">${evt.message}</span>
  `;
  if (prepend) container.insertBefore(div, container.firstChild);
  else container.appendChild(div);
}

async function clearEvents() {
  await ipcRenderer.invoke('clear-events');
  const container = document.getElementById('event-log');
  if (container) container.innerHTML = '';
}

// ═══════════════════════════════════════════════════════════════════════════
// RADIO & SERIAL
// ═══════════════════════════════════════════════════════════════════════════

async function refreshPorts() {
  const result = await ipcRenderer.invoke('serial-list-ports');
  const select = document.getElementById('serial-port-select');
  if (!select) return;
  
  select.innerHTML = '<option value="">— Select Port —</option>';
  setText('serial-hw-avail', result.available ? 'Available' : 'Not Available');
  
  if (result.ports) {
    result.ports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.path;
      opt.textContent = `${p.path} (${p.manufacturer})`;
      select.appendChild(opt);
    });
  }
}

async function connectSerial() {
  const port = document.getElementById('serial-port-select').value;
  const baud = parseInt(document.getElementById('serial-baud').value);
  if (!port) return;
  
  const result = await ipcRenderer.invoke('serial-connect', port, { baudRate: baud });
  if (result.success) {
    document.getElementById('serial-state').textContent = 'CONNECTED';
    document.getElementById('serial-state').className = 'badge-connected';
    document.getElementById('btn-serial-connect').disabled = true;
    document.getElementById('btn-serial-disconnect').disabled = false;
    
    const sbMode = document.getElementById('sb-mode');
    sbMode.textContent = 'LIVE';
    sbMode.className = 'sb-badge badge-live';
    const sbConn = document.getElementById('sb-connection');
    sbConn.textContent = 'CONNECTED';
    sbConn.className = 'sb-badge badge-connected';
  }
}

async function disconnectSerial() {
  await ipcRenderer.invoke('serial-disconnect');
  document.getElementById('serial-state').textContent = 'DISCONNECTED';
  document.getElementById('serial-state').className = 'badge-disconnected';
  document.getElementById('btn-serial-connect').disabled = false;
  document.getElementById('btn-serial-disconnect').disabled = true;
  
  const sbMode = document.getElementById('sb-mode');
  sbMode.textContent = 'SIMULATION';
  sbMode.className = 'sb-badge badge-sim';
  const sbConn = document.getElementById('sb-connection');
  sbConn.textContent = 'DISCONNECTED';
  sbConn.className = 'sb-badge badge-disconnected';
}

async function saveRadioConfig() {
  const config = {
    module: document.getElementById('cfg-radio-module').value,
    primaryFrequency: parseFloat(document.getElementById('cfg-freq-primary').value),
    backupFrequency: parseFloat(document.getElementById('cfg-freq-backup').value),
    bandwidth: parseInt(document.getElementById('cfg-bandwidth').value),
    spreadingFactor: parseInt(document.getElementById('cfg-sf').value),
    codingRate: document.getElementById('cfg-cr').value,
    syncWord: document.getElementById('cfg-syncword').value,
    txPower: parseInt(document.getElementById('cfg-txpower').value),
    preambleLength: parseInt(document.getElementById('cfg-preamble').value),
    teamId: document.getElementById('cfg-team-id').value
  };
  await ipcRenderer.invoke('radio-config-update', config);
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

async function saveSettings() {
  const updates = {
    teamId: document.getElementById('set-team-id').value,
    teamIdFull: document.getElementById('set-team-id-full').value,
    gnssRefLat: parseFloat(document.getElementById('set-ref-lat').value),
    gnssRefLon: parseFloat(document.getElementById('set-ref-lon').value),
    groundAltitudeASL: parseFloat(document.getElementById('set-ground-alt').value)
  };
  await ipcRenderer.invoke('update-config', updates);
}

async function loadDiagnostics() {
  setText('diag-platform', process.platform);
  setText('diag-node', process.versions.node);
  setText('diag-electron', process.versions.electron);
  setText('diag-uptime', `${Math.floor(process.uptime())} s`);
  const mem = process.memoryUsage();
  setText('diag-memory', `${(mem.heapUsed / 1048576).toFixed(1)} / ${(mem.heapTotal / 1048576).toFixed(1)} MB`);
  
  const stats = await ipcRenderer.invoke('get-parser-stats');
  setText('diag-parser', `Valid: ${stats.validPackets} | Invalid: ${stats.invalidPackets} | Gaps: ${stats.sequenceGaps}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function clearTelemetryTable() {
  const tbody = document.getElementById('telemetry-tbody');
  if (tbody) tbody.innerHTML = '';
}

function resetMap() {
  mapPathCoords = [];
  if (mapPath) mapPath.setLatLngs([]);
  if (mapMarker) { map.removeLayer(mapMarker); mapMarker = null; }
  if (mapStartMarker) { map.removeLayer(mapStartMarker); mapStartMarker = null; }
  setText('map-pos', '—');
  setText('map-points', '0');
}

// ─── Clock ────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  setText('sb-time', now.toLocaleTimeString());
}

// ─── Packet Rate Calculator ──────────────────────────────────────────────
function startPacketRateCalc() {
  packetRateInterval = setInterval(() => {
    packetRateValue = packetRateCounter;
    packetRateCounter = 0;
  }, 1000);
}

// ─── Periodic chart render ───────────────────────────────────────────────
function startPeriodicRender() {
  setInterval(() => {
    if (currentPage === 'charts' && chartData.timestamps.length > 0) {
      renderCharts();
    }
    updateClock();
    
    // Recording status auto-refresh
    if (currentPage === 'logger') {
      refreshRecordingStatus();
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  updateClock();
  startPacketRateCalc();
  startPeriodicRender();
  loadScenarios();
  
  // Check serial hardware availability
  ipcRenderer.invoke('serial-list-ports').then(result => {
    setText('serial-hw-avail', result.available ? 'Available' : 'Not Available');
  });
});

// Expose functions globally for HTML inline handlers
Object.assign(window, {
  quickStart, quickPause, quickReset, clearCharts, toggleChartPause,
  sendCommand, saveRadioConfig, refreshPorts, connectSerial, disconnectSerial,
  startRecording, stopRecording, selectOutputDir, refreshFlightFiles, clearEvents,
  simStart, simPause, simResume, simStop, simReset, simStep,
  applySimConfig, saveSettings, setChartWindow, refreshEvents, setSimSpeed,
  navigateTo, chartData, charts
});
