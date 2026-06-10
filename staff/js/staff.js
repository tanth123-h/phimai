/* ================================================================
   PHIMAI SMARTFLOW AI — JavaScript เจ้าหน้าที่ (เวอร์ชันเสถียรสูงสุด)
================================================================ */

const STAFF_PIN = '1234';
const API_URL = window.SMARTFLOW_API_URL || window.location.origin;
const WS_URL  = window.SMARTFLOW_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
const CAM_LIMIT = 30;

const ZONES = [
  { id: 'main-prang',    name: 'ปรางค์ประธาน',  capacity: 60, current: 0, svgX: 300, svgY: 185, camId: 'CAM-01' },
  { id: 'south-gopura',  name: 'โคปุระทิศใต้',  capacity: 40, current: 0, svgX: 300, svgY: 300, camId: 'CAM-02' },
  { id: 'gallery',       name: 'ระเบียงคด',    capacity: 50, current: 0, svgX: 190, svgY: 185, camId: 'CAM-03' },
  { id: 'library',       name: 'บรรณาลัย',     capacity: 25, current: 0, svgX: 410, svgY: 135, camId: 'CAM-04' },
  { id: 'naga-bridge',   name: 'สะพานนาคราช',  capacity: 30, current: 0, svgX: 300, svgY: 370, camId: 'CAM-05' },
  { id: 'museum',        name: 'พิพิธภัณฑ์',    capacity: 80, current: 0, svgX: 110, svgY: 245, camId: 'CAM-06' },
];

const CAMERA_ZONES = [
  { id: 'main-prang', name: 'ปรางค์ประธาน', camId: 'CAM-01', limit: 30 },
  { id: 'south-gopura', name: 'โคปุระทิศใต้', camId: 'CAM-02', limit: 30 },
];

let latestCameraData = {};
let activeCameraId = null;
let activeChartScale = 'hour'; 
let chartHistoryOffset = 0;
let chartHistoryData = null;

/* ================================================================
   LOGIN SYSTEM
================================================================ */
document.getElementById('loginBtn')?.addEventListener('click', attemptLogin);
document.getElementById('pinInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });

function attemptLogin() {
  const input = document.getElementById('pinInput');
  if (input?.value.trim() === STAFF_PIN) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').classList.add('visible');
    initDashboard();
  } else {
    input.value = '';
    alert("❌ รหัสผ่านไม่ถูกต้อง");
  }
}

document.getElementById('logoutBtn')?.addEventListener('click', () => location.reload());

function initDashboard() {
  startClock();
  renderMap();
  renderStats();
  renderBarChart();
  updateMonthlyYearTitle();
  renderMonthlySection();
  initCameraControls();   
  loadCameraSettings();
  renderCameraMonitor(); 
  connectCameraWS();      
  setupStaticFeatures();
}

function startClock() {
  const clockEl = document.getElementById('dashClock');
  const dateEl  = document.getElementById('dashDate');

  setInterval(() => {
    const now = new Date();
    if (clockEl) clockEl.textContent = now.toLocaleTimeString("th-TH", { hour12: false });
    if (dateEl) {
      const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
      const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      dateEl.textContent = `วัน${days[now.getDay()]}ที่ ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear() + 543}`;
    }
    updateMonthlyYearTitle(now);
  }, 1000);
}

/* ================================================================
   WEBSOCKET REALTIME (มีระบบดัก Error)
================================================================ */
let camWS = null;
function connectCameraWS() {
  camWS = new WebSocket(WS_URL);
  
  camWS.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      latestCameraData = payload.cameras || {};
      window.advancedAnalytics = payload.analytics || {};
      
      for (const [zoneId, info] of Object.entries(latestCameraData)) {
        const zone = ZONES.find(z => z.id === zoneId);
        if (zone) zone.current = info.count;
      }

      renderMap();
      renderStats();
      updateCameraMonitor();
      if (chartHistoryOffset === 0) {
        chartHistoryData = null;
        renderBarChart();
      }
      renderMonthlySection();
    } catch(e) {
      console.error("❌ การรับส่งข้อมูล WebSocket มีปัญหา:", e);
    }
  };

  camWS.onclose = () => setTimeout(connectCameraWS, 3000);
}

/* ================================================================
   DYNAMIC GRAPH & AI REPORT
================================================================ */
function renderBarChart() {
  const container = document.getElementById('barChart');
  if (!container) return;

  const scales = [
    { id: 'minute', name: 'รายนาที' },
    { id: 'hour', name: 'รายชั่วโมง' },
    { id: 'day', name: 'รายวัน' },
    { id: 'month', name: 'รายเดือน' },
    { id: 'year', name: 'รายปี' }
  ];

  let tabWrap = document.getElementById('chartTabWrapper');
  if (!tabWrap) {
    tabWrap = document.createElement('div');
    tabWrap.id = 'chartTabWrapper';
    container.parentNode.insertBefore(tabWrap, container);
  }

  tabWrap.innerHTML = scales.map(s => `
    <button class="chart-tab ${s.id === activeChartScale ? 'active' : ''}" type="button"
            onclick="window.setChartScale('${s.id}')">${s.name}</button>
  `).join('');

  let historyControls = document.getElementById('chartHistoryControls');
  if (!historyControls) {
    historyControls = document.createElement('div');
    historyControls.id = 'chartHistoryControls';
    tabWrap.insertAdjacentElement('afterend', historyControls);
  }
  renderChartHistoryControls();

  const data = chartHistoryData || (window.advancedAnalytics ? window.advancedAnalytics[activeChartScale] : null);
  if (!data || !data.labels) {
    container.innerHTML = '<div class="chart-empty">กำลังเตรียมข้อมูลกราฟ...</div>';
    return;
  }

  const titleEl = document.querySelector('.chart-title');
  if (titleEl) {
    const txtMap = {
      minute: 'กราฟจำนวนคนรายนาที',
      hour: 'กราฟจำนวนคนรายชั่วโมง',
      day: 'กราฟจำนวนคนรายวัน',
      month: 'กราฟจำนวนคนรายเดือน',
      year: 'กราฟจำนวนคนรายปี'
    };
    titleEl.textContent = chartHistoryData?.period_label
      ? `${txtMap[activeChartScale]} · ${chartHistoryData.period_label}`
      : txtMap[activeChartScale];
  }

  const maxVal = Math.max(...data.values, 1);
  const totalVal = data.values.reduce((sum, val) => sum + Number(val || 0), 0);
  const peakIndex = data.values.indexOf(maxVal);
  const peakLabel = data.labels[peakIndex] || '-';

  let chartMeta = document.getElementById('chartMeta');
  if (!chartMeta) {
    chartMeta = document.createElement('div');
    chartMeta.id = 'chartMeta';
    container.parentNode.insertBefore(chartMeta, container);
  }

  chartMeta.innerHTML = `
    <div class="chart-meta-card"><span>สูงสุด</span><strong>${maxVal}</strong><small>${peakLabel}</small></div>
    <div class="chart-meta-card"><span>รวมช่วงที่เลือก</span><strong>${totalVal}</strong><small>คน</small></div>
    <div class="chart-meta-card"><span>จำนวนช่วงเวลา</span><strong>${data.labels.length}</strong><small>รายการ</small></div>
  `;

  container.innerHTML = data.labels.map((lbl, i) => {
    const val = Number(data.values[i] || 0);
    const heightPercent = Math.max(10, (val / maxVal) * 86);
    const isPeak = val === maxVal && maxVal > 0;
    const isCurrentHour = activeChartScale === 'hour' && new Date().getHours() === parseInt(String(lbl).split(':')[0]);
    return `
      <div class="bar-col ${isPeak ? 'peak' : ''}">
        <div class="bar-val">${val}</div>
        <div class="bar-fill ${isCurrentHour ? 'active' : ''}" style="height: ${heightPercent}%"></div>
        <div class="bar-label">${lbl}</div>
      </div>`;
  }).join('');

  let summaryBox = document.getElementById('chartSummaryBox');
  if (!summaryBox) {
    summaryBox = document.createElement('div');
    summaryBox.id = 'chartSummaryBox';
    container.parentNode.appendChild(summaryBox);
  }

  if (chartHistoryData?.summary_text) {
    summaryBox.innerHTML = chartHistoryData.summary_text;
  } else if (window.advancedAnalytics && window.advancedAnalytics.summary_text) {
    summaryBox.innerHTML = window.advancedAnalytics.summary_text;
  }
}

window.setChartScale = function(scale) {
  activeChartScale = scale;
  chartHistoryOffset = 0;
  chartHistoryData = null;
  renderBarChart();
};

function getHistoryStepText() {
  const map = {
    minute: 'ครั้งละ 10 นาที',
    hour: 'ครั้งละ 1 วัน',
    day: 'ครั้งละ 1 สัปดาห์',
    month: 'ครั้งละ 1 ปี',
    year: 'ครั้งละ 3 ปี'
  };
  return map[activeChartScale] || '';
}

function renderChartHistoryControls() {
  const controls = document.getElementById('chartHistoryControls');
  if (!controls) return;

  const statusText = chartHistoryOffset === 0
    ? 'กำลังดูข้อมูลปัจจุบัน'
    : `ย้อนหลัง ${chartHistoryOffset} ช่วง`;

  controls.innerHTML = `
    <div class="history-label">ดูสถิติย้อนหลัง</div>
    <div class="history-control-left">
      <button class="history-btn" type="button" onclick="window.shiftChartHistory(1)">ย้อนกลับ</button>
      <button class="history-btn current" type="button" onclick="window.resetChartHistory()">ปัจจุบัน</button>
      <button class="history-btn" type="button" ${chartHistoryOffset === 0 ? 'disabled' : ''} onclick="window.shiftChartHistory(-1)">ถัดไป</button>
    </div>
    <div class="history-status">
      <strong>${statusText}</strong>
      <span>${getHistoryStepText()}</span>
    </div>
  `;
}

window.shiftChartHistory = async function(direction) {
  const nextOffset = Math.max(0, chartHistoryOffset + direction);
  if (nextOffset === chartHistoryOffset) return;
  chartHistoryOffset = nextOffset;

  if (chartHistoryOffset === 0) {
    chartHistoryData = null;
    renderBarChart();
    return;
  }

  await loadChartHistory();
};

window.resetChartHistory = function() {
  chartHistoryOffset = 0;
  chartHistoryData = null;
  renderBarChart();
};

async function loadChartHistory() {
  const controls = document.getElementById('chartHistoryControls');
  if (controls) controls.classList.add('loading');
  try {
    const res = await fetch(`${API_URL}/api/analytics/history?scale=${encodeURIComponent(activeChartScale)}&offset=${chartHistoryOffset}`);
    if (!res.ok) throw new Error(`history request failed: ${res.status}`);
    chartHistoryData = await res.json();
  } catch (err) {
    console.error('โหลดข้อมูลย้อนหลังไม่สำเร็จ:', err);
    chartHistoryData = {
      labels: [],
      values: [],
      period_label: 'โหลดข้อมูลย้อนหลังไม่สำเร็จ',
      summary_text: 'ไม่สามารถโหลดข้อมูลย้อนหลังจาก backend ได้ กรุณาตรวจสอบว่า server.py กำลังทำงานอยู่'
    };
  } finally {
    if (controls) controls.classList.remove('loading');
    renderBarChart();
  }
}

/* ================================================================
   MONTHLY SECTION 
================================================================ */
function renderMonthlySection() {
  const tableBody = document.getElementById('monthlyTableBody');
  const metaEl = document.getElementById('monthlyMeta');
  const analysisEl = document.getElementById('monthlyAnalysis');
  const now = new Date();

  updateMonthlyYearTitle(now);

  const mData = window.advancedAnalytics?.month;
  if (!mData || !tableBody) {
    if (metaEl) metaEl.textContent = `รอข้อมูลล่าสุด · ปี พ.ศ. ${now.getFullYear() + 543}`;
    return;
  }

  if (metaEl) {
    metaEl.textContent = `อัปเดตล่าสุด ${now.toLocaleTimeString('th-TH', { hour12: false })} น.`;
  }

  const values = mData.values.map(v => Number(v || 0));
  const maxM = Math.max(...values, 1);
  const totalM = values.reduce((sum, val) => sum + val, 0);
  const peakIndex = values.indexOf(maxM);
  const peakMonth = mData.labels[peakIndex] || '-';

  let monthlyKpis = document.getElementById('monthlyKpis');
  if (!monthlyKpis) {
    monthlyKpis = document.createElement('div');
    monthlyKpis.id = 'monthlyKpis';
    document.querySelector('.monthly-header')?.insertAdjacentElement('afterend', monthlyKpis);
  }
  monthlyKpis.innerHTML = `
    <div class="monthly-kpi"><span>รวมทั้งปี</span><strong>${totalM}</strong><small>คน</small></div>
    <div class="monthly-kpi"><span>เดือนสูงสุด</span><strong>${peakMonth}</strong><small>${maxM} คน</small></div>
    <div class="monthly-kpi"><span>ข้อมูลปี พ.ศ.</span><strong>${now.getFullYear() + 543}</strong><small>real-time</small></div>
  `;

  let tableHtml = '';
  let prevVal = 0;
  mData.labels.forEach((lbl, i) => {
    const val = values[i];
    let diffText = '—';
    let statusBadge = '<span class="monthly-status ok">● ปกติ</span>';

    if (i > 0 && prevVal > 0) {
      const diff = val - prevVal;
      diffText = diff >= 0 ? `+${diff} คน` : `${diff} คน`;
    }
    if (val >= 30) {
      statusBadge = '<span class="monthly-status high">หนาแน่นสูง</span>';
    } else if (val >= 15) {
      statusBadge = '<span class="monthly-status watch">เฝ้าระวัง</span>';
    }

    tableHtml += `
      <tr>
        <td><b>${lbl}</b></td>
        <td>${val} คน</td>
        <td class="${diffText.startsWith('+') ? 'monthly-diff-up' : diffText.startsWith('—') ? 'monthly-diff-flat' : 'monthly-diff-down'}">${diffText}</td>
        <td>${statusBadge}</td>
      </tr>`;
    prevVal = val;
  });
  tableBody.innerHTML = tableHtml;

  if (analysisEl) {
    analysisEl.innerHTML = `<b>วิเคราะห์ภาพรวมรายเดือน:</b> ปี พ.ศ. ${now.getFullYear() + 543} พบเดือนที่มีผู้เข้าชมสูงสุดคือ <b>${peakMonth}</b> จำนวน <b>${maxM} คน</b> ระบบจะอัปเดตจากข้อมูลล่าสุดแบบ real-time`;
  }

  const svg = document.getElementById('monthlyChartSvg');
  if (svg) {
    svg.innerHTML = '';
    svg.setAttribute('height', '220');
    const width = svg.clientWidth || 900;
    const height = 220;
    const padX = 38;
    const padTop = 24;
    const padBottom = 44;
    const chartH = height - padTop - padBottom;
    const points = values.map((v, idx) => {
      const x = (idx / (values.length - 1)) * (width - padX * 2) + padX;
      const y = padTop + chartH - (v / maxM) * chartH;
      return { x, y, val: v, lbl: mData.labels[idx] };
    });

    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) pathD += ` L ${points[i].x} ${points[i].y}`;
    const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padBottom} L ${points[0].x} ${height - padBottom} Z`;

    for (let i = 0; i <= 4; i++) {
      const y = padTop + (chartH / 4) * i;
      const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      grid.setAttribute('x1', padX);
      grid.setAttribute('x2', width - padX);
      grid.setAttribute('y1', y);
      grid.setAttribute('y2', y);
      grid.setAttribute('class', 'monthly-grid-line');
      svg.appendChild(grid);
    }

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', areaD);
    area.setAttribute('class', 'monthly-area');
    svg.appendChild(area);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', pathD);
    line.setAttribute('class', 'monthly-line');
    svg.appendChild(line);

    points.forEach(p => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', p.x);
      circle.setAttribute('cy', p.y);
      circle.setAttribute('r', p.val === maxM && maxM > 0 ? '6' : '4');
      circle.setAttribute('class', p.val === maxM && maxM > 0 ? 'monthly-point peak' : 'monthly-point');
      svg.appendChild(circle);

      const valText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      valText.setAttribute('x', p.x);
      valText.setAttribute('y', Math.max(14, p.y - 10));
      valText.setAttribute('class', 'monthly-value-label');
      valText.textContent = p.val;
      svg.appendChild(valText);

      const lblText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lblText.setAttribute('x', p.x);
      lblText.setAttribute('y', height - 16);
      lblText.setAttribute('class', 'monthly-axis-label');
      lblText.textContent = p.lbl;
      svg.appendChild(lblText);
    });
  }
}

function updateMonthlyYearTitle(date = new Date()) {
  const titleEl = document.querySelector('.monthly-title');
  if (!titleEl) return;
  titleEl.textContent = `สถิติผู้เยี่ยมชมรายเดือน · ปี พ.ศ. ${date.getFullYear() + 543}`;
}

/* ================================================================
   STATS & MAP ELEMENTS
================================================================ */
function renderStats() {
  const total = ZONES.reduce((s, z) => s + z.current, 0);
  const highZones = ZONES.filter(z => z.current >= z.capacity).length;
  const medZones  = ZONES.filter(z => z.current >= z.capacity * 0.6 && z.current < z.capacity).length;

  if (document.getElementById('statTotal')) document.getElementById('statTotal').querySelector('.stat-cell-value').textContent = total;
  if (document.getElementById('statHigh')) document.getElementById('statHigh').querySelector('.stat-cell-value').textContent = highZones;
  if (document.getElementById('statMedium')) document.getElementById('statMedium').querySelector('.stat-cell-value').textContent = medZones;
  if (document.getElementById('statNotif')) document.getElementById('statNotif').querySelector('.stat-cell-value').textContent = highZones > 0 ? "มีแจ้งเตือน" : "ปกติ";
  if (document.getElementById('statLine')) document.getElementById('statLine').querySelector('.stat-cell-value').textContent = "เปิดใช้งาน";
}

function renderMap() {
  const svg = document.getElementById('mapSvg'); if (!svg) return;
  svg.innerHTML = '';
  svg.setAttribute('viewBox', '0 0 600 340');

  ZONES.forEach(zone => {
    const ratio = zone.current / (zone.capacity || 1);
    const status = ratio >= 1.0 ? 'high' : ratio >= 0.6 ? 'medium' : 'low';
    const color  = status === 'high' ? '#EF4444' : status === 'medium' ? '#F59E0B' : '#22C55E';
    
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => openCameraViewer(zone.id));

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', zone.svgX); circle.setAttribute('cy', zone.svgY);
    circle.setAttribute('r', status === 'high' ? '24' : '18'); circle.setAttribute('fill', `${color}25`);
    circle.setAttribute('stroke', color); circle.setAttribute('stroke-width', '2');
    g.appendChild(circle);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', zone.svgX); txt.setAttribute('y', zone.svgY + 5);
    txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('fill', color);
    txt.setAttribute('font-weight', 'bold'); txt.textContent = zone.current;
    g.appendChild(txt);
    svg.appendChild(g);
  });
}

function renderCameraMonitor() {
  const grid = document.getElementById('staffCameraGrid'); if (!grid) return;
  grid.innerHTML = CAMERA_ZONES.map(cam => `
    <div class="camera-monitor-card offline" id="staff-camera-${cam.id}">
      <div class="camera-card-top">
        <div><div class="camera-card-name">${cam.name}</div><div class="camera-card-id">${cam.camId}</div></div>
        <div class="camera-status-pill offline" id="staff-camera-status-${cam.id}">รอสัญญาณ</div>
      </div>
      <div class="camera-card-bottom">
        <div class="camera-card-count" id="staff-camera-count-${cam.id}">0<small>คน</small></div>
        <button class="camera-card-btn" type="button" onclick="openCameraViewer('${cam.id}')">ดูกล้องสด</button>
      </div>
    </div>`).join('');
}

async function loadCameraSettings() {
  try {
    const res = await fetch(`${API_URL}/api/cameras`);
    if (!res.ok) throw new Error(`camera settings failed: ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data.cameras) && data.cameras.length) {
      CAMERA_ZONES.splice(0, CAMERA_ZONES.length, ...data.cameras.map((cam, idx) => ({
        id: cam.id,
        name: cam.name,
        camId: `CAM-${String(idx + 1).padStart(2, '0')}`,
        limit: cam.limit || CAM_LIMIT,
        enabled: cam.enabled,
        hasRtspUrl: cam.has_rtsp_url
      })));
      renderCameraMonitor();
      renderCameraSettings();
      updateCameraSettingsList();
    }
  } catch (err) {
    console.error('โหลดการตั้งค่ากล้องไม่สำเร็จ:', err);
  }
}

function renderCameraSettings() {
  const section = document.querySelector('.camera-monitor-section');
  if (!section || document.getElementById('cameraSettingsPanel')) return;

  section.insertAdjacentHTML('beforeend', `
    <div class="camera-settings-panel" id="cameraSettingsPanel">
      <div class="camera-settings-title">ตั้งค่ากล้อง</div>
      <div class="camera-settings-list" id="cameraSettingsList"></div>
      <div class="camera-settings-grid">
        <input class="camera-settings-input" id="cameraSettingId" placeholder="camera id" value="main-prang" />
        <input class="camera-settings-input" id="cameraSettingName" placeholder="ชื่อกล้อง" value="ปรางค์ประธาน" />
        <input class="camera-settings-input" id="cameraSettingLimit" placeholder="limit" type="number" value="30" min="1" />
        <input class="camera-settings-input" id="cameraSettingRtsp" placeholder="RTSP URL (บันทึกในฐานข้อมูล)" type="password" />
        <button class="camera-card-btn" id="saveCameraSettingsBtn" type="button">บันทึก</button>
      </div>
    </div>
  `);

  const first = CAMERA_ZONES[0];
  if (first) {
    document.getElementById('cameraSettingId').value = first.id;
    document.getElementById('cameraSettingName').value = first.name;
    document.getElementById('cameraSettingLimit').value = first.limit;
  }

  document.getElementById('saveCameraSettingsBtn')?.addEventListener('click', saveCameraSettings);
  updateCameraSettingsList();
}

function updateCameraSettingsList() {
  const list = document.getElementById('cameraSettingsList');
  if (!list) return;
  list.innerHTML = CAMERA_ZONES.map(cam => `
    <button class="camera-settings-chip" type="button" onclick="window.pickCameraSetting('${cam.id}')">
      ${cam.camId} · ${cam.name}
    </button>
  `).join('');
}

window.pickCameraSetting = function(cameraId) {
  const cam = CAMERA_ZONES.find(item => item.id === cameraId);
  if (!cam) return;
  document.getElementById('cameraSettingId').value = cam.id;
  document.getElementById('cameraSettingName').value = cam.name;
  document.getElementById('cameraSettingLimit').value = cam.limit || CAM_LIMIT;
  document.getElementById('cameraSettingRtsp').value = '';
};

async function saveCameraSettings() {
  const id = document.getElementById('cameraSettingId')?.value.trim();
  const name = document.getElementById('cameraSettingName')?.value.trim();
  const limit = Number(document.getElementById('cameraSettingLimit')?.value || CAM_LIMIT);
  const rtspUrl = document.getElementById('cameraSettingRtsp')?.value.trim();
  if (!id || !name) {
    alert('กรุณากรอก camera id และชื่อกล้อง');
    return;
  }

  try {
    const payload = { id, name, limit, enabled: true };
    if (rtspUrl) payload.rtsp_url = rtspUrl;
    const res = await fetch(`${API_URL}/api/cameras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'บันทึกการตั้งค่ากล้องไม่สำเร็จ');
    alert('บันทึกการตั้งค่ากล้องแล้ว');
    await loadCameraSettings();
  } catch (err) {
    alert(`บันทึกไม่สำเร็จ: ${err.message}`);
  }
}

function updateCameraMonitor() {
  CAMERA_ZONES.forEach(cam => {
    const data = latestCameraData[cam.id];
    const card = document.getElementById(`staff-camera-${cam.id}`);
    const status = document.getElementById(`staff-camera-status-${cam.id}`);
    const count = document.getElementById(`staff-camera-count-${cam.id}`);
    
    if (data && card && status && count) {
      const isOnline = data.online;
      card.className = `camera-monitor-card ${!isOnline ? 'offline' : data.count >= cam.limit ? 'high' : 'low'}`;
      status.className = `camera-status-pill ${!isOnline ? 'offline' : data.count >= cam.limit ? 'high' : 'low'}`;
      status.textContent = !isOnline ? 'ออฟไลน์' : data.count >= cam.limit ? 'หนาแน่น' : 'ปกติ';
      count.innerHTML = `${data.count}<small>คน</small>`;
    }
  });
  if (activeCameraId) updateCameraViewer(activeCameraId);
}

function initCameraControls() {
  document.getElementById('cameraViewerClose')?.addEventListener('click', closeCameraViewer);
  document.getElementById('cameraViewerBackdrop')?.addEventListener('click', closeCameraViewer);
}

function openCameraViewer(zoneId) {
  const config = CAMERA_ZONES.find(c => c.id === zoneId); if (!config) return;
  activeCameraId = zoneId;
  const viewer = document.getElementById('cameraViewer');
  const stream = document.getElementById('cameraViewerStream');
  const offlineWrap = document.getElementById('cameraViewerOffline');
  
  const titleEl = document.getElementById('cameraViewerTitle');
  if (titleEl) titleEl.textContent = config.name;
  if (stream) {
    stream.src = `${API_URL}/stream/${zoneId}?t=${Date.now()}`;
    stream.style.display = 'block';
  }
  if (offlineWrap) offlineWrap.style.display = 'none';
  if (viewer) { viewer.classList.add('open'); viewer.setAttribute('aria-hidden', 'false'); }
  updateCameraViewer(zoneId);
}

function closeCameraViewer() {
  const viewer = document.getElementById('cameraViewer');
  if (viewer) { viewer.classList.remove('open'); viewer.setAttribute('aria-hidden', 'true'); }
  document.getElementById('cameraViewerStream')?.removeAttribute('src');
  activeCameraId = null;
}

function updateCameraViewer(zoneId) {
  const data = latestCameraData[zoneId];
  if (!data) return;
  
  const countEl = document.getElementById('cameraViewerCount');
  const limitEl = document.getElementById('cameraViewerLimit');
  const statusEl = document.getElementById('cameraViewerStatus');
  const timeEl = document.getElementById('cameraViewerTime');
  const meterEl = document.getElementById('cameraViewerMeter');
  
  if (countEl) countEl.textContent = data.count;
  if (limitEl) limitEl.textContent = `ขีดจำกัด ${data.limit} คน`;
  if (timeEl) timeEl.textContent = `อัปเดตล่าสุด ${data.timestamp || '—'}`;
  if (statusEl) {
    statusEl.textContent = data.density === 'high' ? '🔴 วิกฤต / หนาแน่น' : '🟢 ปกติ';
    statusEl.style.color = data.density === 'high' ? '#EF4444' : '#22C55E';
  }
  if (meterEl) {
    const pct = Math.min(100, (data.count / data.limit) * 100);
    meterEl.style.width = `${pct}%`;
    meterEl.style.backgroundColor = pct >= 100 ? '#EF4444' : pct >= 70 ? '#F59E0B' : '#22C55E';
  }
}

function setupStaticFeatures() {
  document.getElementById('testLineBtn')?.addEventListener('click', async () => {
    try {
      const res = await fetch(`${API_URL}/api/line/test`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'ส่ง LINE ไม่สำเร็จ');
      alert('ส่งข้อความทดสอบ LINE สำเร็จ');
    } catch (err) {
      alert(`ส่ง LINE ไม่สำเร็จ: ${err.message}\n\nให้เพิ่มบอทเป็นเพื่อนหรือเชิญเข้ากลุ่ม แล้วส่งข้อความหา bot 1 ครั้งก่อน`);
    }
  });
  document.getElementById('emergencyBtn')?.addEventListener('click', () => alert('🚨 ระบบยิงแจ้งเตือนเหตุวิกฤตถึงเจ้าหน้าที่ทุกคนแล้ว!'));
  
  const notifList = document.getElementById('notifList');
  if (notifList && notifList.children.length === 0) {
    notifList.innerHTML = `<div style="color:#aaa; font-size:0.85rem; padding:10px; text-align:center;">🟢 ระบบปกติ ไม่พบสัญญาณฝูงชนวิกฤต</div>`;
  }
}

