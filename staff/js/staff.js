/* ================================================================
   PHIMAI SMARTFLOW AI — JavaScript เจ้าหน้าที่
   ไฟล์: staff/js/staff.js
   ⚠️ ไม่เชื่อมต่อกับหน้าสาธารณะ
================================================================ */

/* ================================================================
   1. รหัสผ่าน — เปลี่ยนได้ที่นี่
   (ในระบบจริงควรใช้ server-side authentication)
================================================================ */
const STAFF_PIN = '1234';

/* ================================================================
   2. ข้อมูลโซน — แก้ไขชื่อโซน ความจุ และตำแหน่งได้ที่นี่
================================================================ */
const ZONES = [
  {
    id: 'main-prang',
    name: 'ปรางค์ประธาน',
    nameEn: 'Main Prang',
    capacity: 60,
    current: 87,
    svgX: 300, svgY: 185,
    camId: 'CAM-01',
  },
  {
    id: 'south-gopura',
    name: 'โคปุระทิศใต้',
    nameEn: 'South Gopura',
    capacity: 40,
    current: 32,
    svgX: 300, svgY: 300,
    camId: 'CAM-02',
  },
  {
    id: 'gallery',
    name: 'ระเบียงคด',
    nameEn: 'Gallery Corridor',
    capacity: 50,
    current: 41,
    svgX: 190, svgY: 185,
    camId: 'CAM-03',
  },
  {
    id: 'library',
    name: 'บรรณาลัย',
    nameEn: 'Library',
    capacity: 25,
    current: 8,
    svgX: 410, svgY: 135,
    camId: 'CAM-04',
  },
  {
    id: 'naga-bridge',
    name: 'สะพานนาคราช',
    nameEn: 'Naga Bridge',
    capacity: 30,
    current: 19,
    svgX: 300, svgY: 370,
    camId: 'CAM-05',
  },
  {
    id: 'museum',
    name: 'พิพิธภัณฑ์',
    nameEn: 'Museum',
    capacity: 80,
    current: 14,
    svgX: 110, svgY: 245,
    camId: 'CAM-06',
  },
];

/* ================================================================
   3. ข้อมูลผู้ค้าบริเวณใกล้เคียง — เพิ่ม/ลดรายชื่อได้
================================================================ */
const VENDORS = [
  { name: 'ร้านก๋วยเตี๋ยวป้าแดง',     dist: '120 ม.', status: 'notified' },
  { name: 'แผงของฝากพิมาย',             dist: '85 ม.',  status: 'notified' },
  { name: 'ร้านน้ำอ้อยสดสุขใจ',          dist: '200 ม.', status: 'pending'  },
  { name: 'ร้านข้าวมันไก่โคราช',          dist: '340 ม.', status: 'pending'  },
  { name: 'หาบเร่ผลไม้ตัดแว่น',          dist: '50 ม.',  status: 'idle'     },
];

/* ================================================================
   4. ตัวแปร State
================================================================ */
let notifLog = [];
let alertIdCounter = 0;
let simulationRunning = false;
let simTimer = null;
let barHeights = [55, 40, 70, 88, 62, 45, 30, 72]; // % เปอร์เซ็นต์แต่ละชั่วโมง

/* ================================================================
   5. LOGIN
================================================================ */
document.getElementById('loginBtn')?.addEventListener('click', attemptLogin);
document.getElementById('pinInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptLogin();
});

function attemptLogin() {
  const input = document.getElementById('pinInput');
  const error = document.getElementById('loginError');
  if (!input) return;

  if (input.value.trim() === STAFF_PIN) {
    // สำเร็จ
    document.getElementById('loginScreen').style.display = 'none';
    const dash = document.getElementById('dashboard');
    dash.classList.add('visible');
    initDashboard();
  } else {
    error.textContent = '❌ รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่';
    input.value = '';
    input.focus();
    input.style.borderColor = 'var(--red)';
    setTimeout(() => {
      input.style.borderColor = '';
      error.textContent = '';
    }, 2000);
  }
}

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  location.reload();
});

/* ================================================================
   6. INIT DASHBOARD
================================================================ */
function initDashboard() {
  startClock();
  renderMap();
  renderStats();
  renderNotifPanel();
  renderVendorList();
  renderBarChart();
  startSimulation();
  initMonthlyAnalytics();
}

/* ================================================================
   7. CLOCK
================================================================ */
function startClock() {
  const clockEl = document.getElementById('dashClock');
  const dateEl  = document.getElementById('dashDate');

  function update() {
    const now = new Date();
    if (clockEl) clockEl.textContent =
      now.getHours().toString().padStart(2,'0') + ':' +
      now.getMinutes().toString().padStart(2,'0') + ':' +
      now.getSeconds().toString().padStart(2,'0');
    if (dateEl) {
      const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
      const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      dateEl.textContent = `วัน${days[now.getDay()]}ที่ ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear() + 543}`;
    }
  }
  update();
  setInterval(update, 1000);
}

/* ================================================================
   8. STAT ROW
================================================================ */
function renderStats() {
  const total = ZONES.reduce((s, z) => s + z.current, 0);
  const highZones  = ZONES.filter(z => z.current / z.capacity > 1.2).length;
  const medZones   = ZONES.filter(z => z.current / z.capacity >= 0.7 && z.current / z.capacity <= 1.2).length;

  setStatCell('statTotal',     total,       '▲ 12 จากชั่วโมงก่อน', 'delta-up');
  setStatCell('statHigh',      highZones,   'โซนที่ต้องระวัง',       highZones > 0 ? 'delta-up' : 'delta-flat');
  setStatCell('statMedium',    medZones,    'โซนปานกลาง',            'delta-flat');
  setStatCell('statNotif',     notifLog.length || 3, 'การแจ้งเตือนวันนี้', 'delta-flat');
  setStatCell('statLine',      5,           'ส่ง LINE แล้ว',         'delta-down');
}

function setStatCell(id, value, sub, deltaClass) {
  const el = document.getElementById(id);
  if (!el) return;
  const valEl   = el.querySelector('.stat-cell-value');
  const subEl   = el.querySelector('.stat-cell-delta');
  if (valEl) valEl.textContent = value;
  if (subEl) { subEl.textContent = sub; subEl.className = `stat-cell-delta ${deltaClass}`; }
}

/* ================================================================
   9. MAP SVG
================================================================ */
function renderMap() {
  const svg = document.getElementById('mapSvg');
  if (!svg) return;
  svg.innerHTML = '';

  const W = 600, H = 340;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  /* -- ผนังปราสาท (outline) -- */
  const walls = [
    // กำแพงชั้นนอก
    { x: 40,  y: 30,  w: 520, h: 280, stroke: 'rgba(217,123,53,0.2)', fill: 'none', sw: 1.5 },
    // กำแพงชั้นกลาง
    { x: 100, y: 75,  w: 400, h: 190, stroke: 'rgba(217,123,53,0.3)', fill: 'none', sw: 1.5 },
    // กำแพงชั้นใน
    { x: 200, y: 130, w: 200, h: 110, stroke: 'rgba(217,123,53,0.45)', fill: 'rgba(217,123,53,0.04)', sw: 2 },
  ];
  walls.forEach(w => {
    const rect = createSVGEl('rect');
    Object.assign(rect, {});
    rect.setAttribute('x', w.x);
    rect.setAttribute('y', w.y);
    rect.setAttribute('width',  w.w);
    rect.setAttribute('height', w.h);
    rect.setAttribute('stroke', w.stroke);
    rect.setAttribute('stroke-width', w.sw);
    rect.setAttribute('fill', w.fill || 'none');
    rect.setAttribute('rx', '3');
    svg.appendChild(rect);
  });

  /* -- ป้ายหัวมุม -- */
  const corners = [
    { x: 55,  y: 45,  label: 'N' },
    { x: 540, y: 45,  label: 'E' },
    { x: 55,  y: 285, label: 'W' },
    { x: 540, y: 285, label: 'S' },
  ];
  corners.forEach(c => {
    const t = createSVGEl('text');
    t.setAttribute('x', c.x); t.setAttribute('y', c.y);
    t.setAttribute('fill', 'rgba(217,123,53,0.25)');
    t.setAttribute('font-size', '9');
    t.setAttribute('font-family', 'var(--font-ui)');
    t.setAttribute('text-anchor', 'middle');
    t.textContent = c.label;
    svg.appendChild(t);
  });

  /* -- กล้อง (camera icons) -- */
  const cameras = [
    { x: 155, y: 90 }, { x: 445, y: 90 },
    { x: 155, y: 250 }, { x: 445, y: 250 },
  ];
  cameras.forEach((c, i) => {
    const g = createSVGEl('g');
    g.setAttribute('class', 'camera-dot');
    g.setAttribute('title', `CAM-0${i+1}`);

    const circle = createSVGEl('circle');
    circle.setAttribute('cx', c.x); circle.setAttribute('cy', c.y);
    circle.setAttribute('r', '7');
    circle.setAttribute('fill', 'rgba(59,130,246,0.2)');
    circle.setAttribute('stroke', 'rgba(59,130,246,0.5)');
    circle.setAttribute('stroke-width', '1');

    const dot = createSVGEl('circle');
    dot.setAttribute('cx', c.x); dot.setAttribute('cy', c.y);
    dot.setAttribute('r', '2.5');
    dot.setAttribute('fill', 'rgba(59,130,246,0.8)');

    g.appendChild(circle); g.appendChild(dot);
    svg.appendChild(g);
  });

  /* -- โซน -- */
  ZONES.forEach(zone => {
    const ratio = zone.current / zone.capacity;
    const status = ratio > 1.2 ? 'high' : ratio >= 0.7 ? 'medium' : 'low';
    const color  = status === 'high' ? '#EF4444' : status === 'medium' ? '#F59E0B' : '#22C55E';
    const radius = status === 'high' ? 28 : status === 'medium' ? 22 : 18;

    const g = createSVGEl('g');
    g.setAttribute('class', 'zone-circle');
    g.setAttribute('data-zone', zone.id);
    g.addEventListener('click', () => showZoneInfo(zone));

    /* pulse ring (แสดงเฉพาะตอน high) */
    if (status === 'high') {
      const ring = createSVGEl('circle');
      ring.setAttribute('cx', zone.svgX); ring.setAttribute('cy', zone.svgY);
      ring.setAttribute('r', radius + 8);
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', color);
      ring.setAttribute('stroke-width', '1.5');
      ring.setAttribute('opacity', '0.6');
      ring.setAttribute('class', 'zone-alert-ring');
      g.appendChild(ring);
    }

    /* วงกลมหลัก */
    const circle = createSVGEl('circle');
    circle.setAttribute('cx', zone.svgX); circle.setAttribute('cy', zone.svgY);
    circle.setAttribute('r', radius);
    circle.setAttribute('fill', `${color}25`);
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', '2');
    g.appendChild(circle);

    /* ตัวเลขผู้เยี่ยม */
    const countText = createSVGEl('text');
    countText.setAttribute('x', zone.svgX); countText.setAttribute('y', zone.svgY + 4);
    countText.setAttribute('class', 'zone-count-text');
    countText.setAttribute('fill', color);
    countText.textContent = zone.current;
    g.appendChild(countText);

    /* ชื่อโซน */
    const labelText = createSVGEl('text');
    labelText.setAttribute('x', zone.svgX);
    labelText.setAttribute('y', zone.svgY + radius + 13);
    labelText.setAttribute('class', 'zone-label-text');
    labelText.textContent = zone.name;
    g.appendChild(labelText);

    svg.appendChild(g);
  });
}

function createSVGEl(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

/* ================================================================
   10. NOTIFICATION PANEL
================================================================ */
function renderNotifPanel() {
  const panel = document.getElementById('notifList');
  if (!panel) return;
  panel.innerHTML = '';

  /* -- การแจ้งเตือนเริ่มต้น -- */
  const initialNotifs = [
    {
      color: 'red',
      icon: '🚨',
      badge: 'badge-red',
      badgeText: 'วิกฤต',
      title: 'ปรางค์ประธาน — ผู้เยี่ยมชมเกินความจุ',
      body: 'พบผู้เยี่ยมชม 87 คน (ความจุสูงสุด 60) · ส่งเจ้าหน้าที่ไปโซน A-2 แล้ว',
      time: '14:31',
      hasLine: true,
      lineMsg: 'แจ้งเจ้าหน้าที่ 3 คน · สายตรวจ 1 คน',
      actions: ['ส่งเจ้าหน้าที่เพิ่ม', 'รับทราบ']
    },
    {
      color: 'yellow',
      icon: '⚠️',
      badge: 'badge-yellow',
      badgeText: 'เฝ้าระวัง',
      title: 'ระเบียงคด — ความหนาแน่นปานกลาง',
      body: 'ผู้เยี่ยมชม 41 คน (82% ของความจุ) · แนวโน้มเพิ่มขึ้น ควรติดตาม',
      time: '14:28',
      hasLine: false,
      actions: ['เฝ้าดู', 'รับทราบ']
    },
    {
      color: 'green',
      icon: '♿',
      badge: 'badge-blue',
      badgeText: 'ช่วยเหลือ',
      title: 'ตรวจพบผู้สูงอายุ — ต้องการความช่วยเหลือ',
      body: 'AI ตรวจพบผู้สูงอายุเดินช้าบริเวณโคปุระทิศใต้ · ส่งเจ้าหน้าที่ไปรับแล้ว',
      time: '14:25',
      hasLine: true,
      lineMsg: 'แจ้งเจ้าหน้าที่ accessibility 1 คน',
      actions: ['รับทราบ']
    },
    {
      color: 'line',
      icon: '💬',
      badge: 'badge-line',
      badgeText: 'LINE',
      title: 'แจ้งผู้ค้าแผงลอยใกล้เคียง',
      body: 'ส่ง LINE แจ้ง 2 ร้านค้า: ร้านก๋วยเตี๋ยวป้าแดง + แผงของฝากพิมาย · ให้เตรียมพร้อมรับลูกค้า',
      time: '14:20',
      hasLine: false,
      actions: ['ดูรายชื่อผู้ค้า']
    },
    {
      color: 'green',
      icon: '✅',
      badge: 'badge-green',
      badgeText: 'ปกติ',
      title: 'พิพิธภัณฑ์ — ผู้เยี่ยมชมน้อย',
      body: 'ผู้เยี่ยมชม 14 คน (17% ของความจุ) · สถานการณ์ปกติ ไม่ต้องดำเนินการ',
      time: '14:18',
      hasLine: false,
      actions: ['รับทราบ']
    },
  ];

  initialNotifs.forEach(n => panel.appendChild(buildNotifCard(n)));
}

function buildNotifCard(data) {
  const card = document.createElement('div');
  card.className = `notif-item ${data.color}`;

  let html = `
    <div class="notif-header">
      <div class="notif-icon-type">
        <span class="notif-icon">${data.icon}</span>
        <span class="notif-type-badge ${data.badge}">${data.badgeText}</span>
      </div>
      <span class="notif-time">${data.time}</span>
    </div>
    <div class="notif-title">${data.title}</div>
    <div class="notif-body">${data.body}</div>
  `;
  if (data.hasLine && data.lineMsg) {
    html += `
      <div class="notif-line-msg">
        <div class="line-logo">💬</div>
        <div class="line-text"><strong>ส่ง LINE แล้ว</strong>${data.lineMsg}</div>
      </div>
    `;
  }
  html += `<div class="notif-actions">`;
  (data.actions || []).forEach((a, i) => {
    html += `<button class="notif-act-btn ${i === 0 ? 'primary' : ''}" onclick="this.parentElement.parentElement.remove()">${a}</button>`;
  });
  html += `</div>`;

  card.innerHTML = html;
  return card;
}

/* ================================================================
   11. VENDOR LIST
================================================================ */
function renderVendorList() {
  const el = document.getElementById('vendorList');
  if (!el) return;
  el.innerHTML = '';
  VENDORS.forEach(v => {
    el.innerHTML += `
      <div class="vendor-item">
        <div class="vendor-status ${v.status}"></div>
        <div class="vendor-name">${v.name}</div>
        <div class="vendor-dist">${v.dist}</div>
      </div>
    `;
  });
}

/* ================================================================
   12. BAR CHART (ผู้เยี่ยมชมรายชั่วโมง)
================================================================ */
function renderBarChart() {
  const container = document.getElementById('barChart');
  if (!container) return;

  const hours  = ['07', '08', '09', '10', '11', '12', '13', '14'];
  const max    = Math.max(...barHeights);
  container.innerHTML = '';

  hours.forEach((h, i) => {
    const isCurrent = i === 7;
    const isHigh    = barHeights[i] > 80;
    const pct = (barHeights[i] / max) * 100;

    container.innerHTML += `
      <div class="bar-col">
        <div class="bar-val">${barHeights[i]}</div>
        <div class="bar-fill ${isCurrent ? 'active' : ''} ${isHigh ? 'high' : ''}"
             style="height: ${pct}%"></div>
        <div class="bar-label">${h}:00</div>
      </div>
    `;
  });
}

/* ================================================================
   13. ZONE INFO POPUP (คลิกที่โซนบนแผนที่)
================================================================ */
function showZoneInfo(zone) {
  const ratio   = zone.current / zone.capacity;
  const status  = ratio > 1.2 ? 'เกินความจุ 🔴' : ratio >= 0.7 ? 'ปานกลาง 🟡' : 'ปกติ 🟢';
  showToast(`📍 ${zone.name}`, `ผู้เยี่ยมชม: ${zone.current} คน · ความจุ: ${zone.capacity} · สถานะ: ${status} · กล้อง: ${zone.camId}`);
}

/* ================================================================
   14. TOAST NOTIFICATIONS
================================================================ */
function showToast(title, body, duration = 5000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon">🔔</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-body">${body}</div>
    </div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('exiting');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

/* ================================================================
   15. SIMULATION — เลียนแบบการเปลี่ยนแปลงแบบเรียลไทม์
   ทุก 8 วินาที ตัวเลขในโซนจะเปลี่ยน และมีการแจ้งเตือนใหม่
================================================================ */
function startSimulation() {
  if (simulationRunning) return;
  simulationRunning = true;
  scheduleNextEvent();
}

function scheduleNextEvent() {
  const delay = 7000 + Math.random() * 8000; // 7–15 วินาที
  simTimer = setTimeout(() => {
    simulateEvent();
    scheduleNextEvent();
  }, delay);
}

const simEvents = [
  () => {
    // ผู้คนเพิ่มที่ปรางค์ประธาน
    const zone = ZONES.find(z => z.id === 'main-prang');
    zone.current += Math.floor(Math.random() * 6) + 2;
    renderMap();
    renderStats();
    showToast('🚨 แจ้งเตือนระดับสูง', `ปรางค์ประธาน: ${zone.current} คน (เกินความจุ)`);
    addNotif({
      color: 'red', icon: '🚨', badge: 'badge-red', badgeText: 'วิกฤต',
      title: 'ปรางค์ประธาน — ผู้เยี่ยมชมเพิ่มขึ้น',
      body: `ตรวจพบผู้เยี่ยมชม ${zone.current} คน · ส่ง LINE แจ้งเจ้าหน้าที่แล้ว`,
      time: nowStr(), hasLine: true, lineMsg: 'แจ้งเจ้าหน้าที่ทันที',
      actions: ['ส่งเจ้าหน้าที่', 'รับทราบ']
    });
  },
  () => {
    // ผู้สูงอายุต้องการความช่วยเหลือ
    const zones = ['โคปุระทิศใต้', 'ระเบียงคด', 'สะพานนาคราช'];
    const loc = zones[Math.floor(Math.random() * zones.length)];
    showToast('♿ ความช่วยเหลือ', `ตรวจพบผู้สูงอายุที่ ${loc} · กำลังส่งเจ้าหน้าที่`);
    addNotif({
      color: 'blue', icon: '🧓', badge: 'badge-blue', badgeText: 'ช่วยเหลือ',
      title: `ตรวจพบผู้สูงอายุ — ${loc}`,
      body: 'AI ตรวจพบการเดินช้าผิดปกติ · ส่ง LINE แจ้งเจ้าหน้าที่แล้ว',
      time: nowStr(), hasLine: true, lineMsg: 'แจ้งเจ้าหน้าที่ accessibility',
      actions: ['รับทราบ']
    });
  },
  () => {
    // แจ้งผู้ค้า
    showToast('💬 LINE ผู้ค้า', 'ผู้เยี่ยมชมพลุกพล่าน · แจ้งผู้ค้าใกล้เคียงแล้ว 3 ร้าน');
    addNotif({
      color: 'line', icon: '🛍️', badge: 'badge-line', badgeText: 'LINE',
      title: 'แจ้งผู้ค้าแผงลอยบริเวณใกล้เคียง',
      body: 'ส่ง LINE แจ้งเตือน 3 ร้านค้า ให้เตรียมเปิดแผง · วันนี้มีผู้เยี่ยมชมมากกว่าปกติ',
      time: nowStr(), hasLine: false,
      actions: ['ดูรายชื่อ', 'รับทราบ']
    });
  },
  () => {
    // ผู้คนลดลงที่โซนปกติ
    const zone = ZONES.find(z => z.id === 'museum');
    zone.current = Math.max(5, zone.current - 3);
    renderMap();
    renderStats();
    showToast('✅ สถานะปกติ', `พิพิธภัณฑ์: ผู้เยี่ยมชมลดลงเหลือ ${zone.current} คน`);
  },
  () => {
    // อัปเดต bar chart
    barHeights = barHeights.map(h => {
      const change = (Math.random() - 0.4) * 10;
      return Math.max(10, Math.min(100, h + change));
    });
    renderBarChart();
  }
];

let simEventIndex = 0;
function simulateEvent() {
  const event = simEvents[simEventIndex % simEvents.length];
  simEventIndex++;
  event();
}


/* ================================================================
   17. MONTHLY ANALYTICS — สถิติผู้เยี่ยมชมรายเดือน 12 เดือน
================================================================ */

const MONTHLY_DATA = [
  { month: 'ม.ค.',  monthEn: 'Jan', visitors: 14820, note: 'เปิดปีใหม่ นักท่องเที่ยวไทยเยอะ' },
  { month: 'ก.พ.',  monthEn: 'Feb', visitors: 13540, note: 'ท่องเที่ยวช่วงปกติ' },
  { month: 'มี.ค.', monthEn: 'Mar', visitors: 18960, note: 'นักเรียน-นักศึกษาทัศนศึกษาช่วงปิดเทอม' },
  { month: 'เม.ย.', monthEn: 'Apr', visitors: 24310, note: 'สงกรานต์ — พีคสูงสุดของปี' },
  { month: 'พ.ค.',  monthEn: 'May', visitors: 16480, note: 'หลังสงกรานต์ยอดลดลง' },
  { month: 'มิ.ย.', monthEn: 'Jun', visitors: 11230, note: 'หน้าฝน นักท่องเที่ยวน้อยลง' },
  { month: 'ก.ค.',  monthEn: 'Jul', visitors: 9870,  note: 'ต่ำสุดของปี — ฝนตกหนัก' },
  { month: 'ส.ค.',  monthEn: 'Aug', visitors: 10540, note: 'เริ่มฟื้นตัวเล็กน้อย' },
  { month: 'ก.ย.',  monthEn: 'Sep', visitors: 12660, note: 'วันหยุดยาว-อาเซียน' },
  { month: 'ต.ค.',  monthEn: 'Oct', visitors: 19430, note: 'งานเทศกาลปราสาทพิมายไนท์บาซาร์' },
  { month: 'พ.ย.',  monthEn: 'Nov', visitors: 22150, note: 'งานแสดงแสงสีเสียงปราสาทพิมาย' },
  { month: 'ธ.ค.',  monthEn: 'Dec', visitors: 21080, note: 'ปีใหม่ นักท่องเที่ยวต่างชาติเพิ่ม' },
];

function initMonthlyAnalytics() {
  renderMonthlyChart();
  renderMonthlyTable();
  renderMonthlyAnalysis();

  const total = MONTHLY_DATA.reduce((s, m) => s + m.visitors, 0);
  const avg   = Math.round(total / 12);
  const metaEl = document.getElementById('monthlyMeta');
  if (metaEl) metaEl.textContent = `รวม ${total.toLocaleString()} คน · เฉลี่ย ${avg.toLocaleString()} คน/เดือน`;
}

/* ---- Line Chart SVG ---- */
function renderMonthlyChart() {
  const svg = document.getElementById('monthlyChartSvg');
  if (!svg) return;

  const W = 900, H = 160;
  const padL = 54, padR = 20, padT = 18, padB = 32;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', H);

  const vals    = MONTHLY_DATA.map(m => m.visitors);
  const maxVal  = Math.max(...vals);
  const minVal  = Math.min(...vals);
  const maxIdx  = vals.indexOf(maxVal);
  const minIdx  = vals.indexOf(minVal);

  const xStep = chartW / (MONTHLY_DATA.length - 1);
  const pts   = vals.map((v, i) => ({
    x: padL + i * xStep,
    y: padT + chartH - ((v - minVal) / (maxVal - minVal + 1000)) * chartH,
  }));

  /* gradient area fill */
  const defs = `
    <defs>
      <linearGradient id="mgGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#D97B35" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#D97B35" stop-opacity="0.01"/>
      </linearGradient>
    </defs>`;

  /* area path */
  const areaPath = [
    `M ${pts[0].x} ${padT + chartH}`,
    ...pts.map(p => `L ${p.x} ${p.y}`),
    `L ${pts[pts.length-1].x} ${padT + chartH}`,
    'Z'
  ].join(' ');

  /* line path */
  const linePath = pts.map((p,i) => `${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ');

  /* grid lines */
  let gridLines = '';
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const y = padT + (chartH / gridCount) * i;
    const val = Math.round(maxVal - ((maxVal - minVal) / gridCount) * i);
    gridLines += `
      <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"
            stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
      <text x="${padL - 6}" y="${y + 4}" text-anchor="end"
            font-family="'JetBrains Mono',monospace" font-size="9"
            fill="rgba(255,255,255,0.25)">${(val/1000).toFixed(0)}k</text>`;
  }

  /* month labels */
  let labels = '';
  MONTHLY_DATA.forEach((m, i) => {
    labels += `
      <text x="${pts[i].x}" y="${H - 4}" text-anchor="middle"
            font-family="'Sarabun',sans-serif" font-size="9.5"
            fill="${i === maxIdx ? '#22C55E' : i === minIdx ? '#3B82F6' : 'rgba(255,255,255,0.35)'}"
            font-weight="${(i===maxIdx||i===minIdx)?'700':'400'}">${m.month}</text>`;
  });

  /* data points */
  let dots = '';
  pts.forEach((p, i) => {
    const isMax = i === maxIdx;
    const isMin = i === minIdx;
    const r     = isMax || isMin ? 5 : 3;
    const fill  = isMax ? '#22C55E' : isMin ? '#3B82F6' : '#D97B35';
    dots += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" stroke="#0A0600" stroke-width="1.5"/>`;
    if (isMax || isMin) {
      const label = isMax ? `▲ ${(maxVal/1000).toFixed(1)}k` : `▼ ${(minVal/1000).toFixed(1)}k`;
      const dy = isMax ? -10 : 14;
      dots += `<text x="${p.x}" y="${p.y + dy}" text-anchor="middle"
                     font-family="'JetBrains Mono',monospace" font-size="9" font-weight="700"
                     fill="${fill}">${label}</text>`;
    }
  });

  svg.innerHTML = `
    ${defs}
    ${gridLines}
    <path d="${areaPath}" fill="url(#mgGrad)"/>
    <path d="${linePath}" fill="none" stroke="#D97B35" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${labels}
  `;
}

/* ---- Monthly Table ---- */
function renderMonthlyTable() {
  const tbody = document.getElementById('monthlyTableBody');
  if (!tbody) return;

  const vals   = MONTHLY_DATA.map(m => m.visitors);
  const maxVal = Math.max(...vals);
  const minVal = Math.min(...vals);

  tbody.innerHTML = '';
  MONTHLY_DATA.forEach((m, i) => {
    const prev  = i > 0 ? MONTHLY_DATA[i-1].visitors : null;
    const delta = prev !== null ? m.visitors - prev : null;
    const pct   = prev !== null ? ((delta / prev) * 100).toFixed(1) : null;

    const isMax = m.visitors === maxVal;
    const isMin = m.visitors === minVal;

    let deltaHtml = '<span class="month-delta-flat">—</span>';
    if (delta !== null) {
      if (delta > 0)
        deltaHtml = `<span class="month-delta-up">▲ +${delta.toLocaleString()} (+${pct}%)</span>`;
      else if (delta < 0)
        deltaHtml = `<span class="month-delta-down">▼ ${delta.toLocaleString()} (${pct}%)</span>`;
      else
        deltaHtml = `<span class="month-delta-flat">→ 0 (0%)</span>`;
    }

    let badge = '';
    if (isMax)        badge = '<span class="month-badge month-badge-peak">🏆 สูงสุด</span>';
    else if (isMin)   badge = '<span class="month-badge month-badge-low">📉 ต่ำสุด</span>';
    else if (m.visitors > 18000) badge = '<span class="month-badge month-badge-high">🔥 ช่วงพีค</span>';
    else              badge = '<span class="month-badge month-badge-normal">ปกติ</span>';

    const tr = document.createElement('tr');
    if (isMax) tr.className = 'month-highlight-max';
    if (isMin) tr.className = 'month-highlight-min';
    tr.innerHTML = `
      <td>${m.month}</td>
      <td>${m.visitors.toLocaleString()}</td>
      <td>${deltaHtml}</td>
      <td>${badge}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---- Analysis Cards ---- */
function renderMonthlyAnalysis() {
  const el = document.getElementById('monthlyAnalysis');
  if (!el) return;

  const vals   = MONTHLY_DATA.map(m => m.visitors);
  const maxVal = Math.max(...vals);
  const minVal = Math.min(...vals);
  const maxM   = MONTHLY_DATA[vals.indexOf(maxVal)];
  const minM   = MONTHLY_DATA[vals.indexOf(minVal)];
  const total  = vals.reduce((a,b) => a+b, 0);
  const avg    = Math.round(total / 12);
  const yoy    = '+8.4%'; // สมมุติเทียบปีที่แล้ว

  el.innerHTML = `
    <div class="analysis-card">
      <div class="analysis-card-title">🏆 เดือนที่ผู้เยี่ยมชมมากที่สุด</div>
      <div class="analysis-card-body">
        <strong>${maxM.month} — ${maxVal.toLocaleString()} คน</strong><br>
        ${maxM.note} ทำให้ยอดผู้เยี่ยมชมพุ่งสูงกว่าค่าเฉลี่ยถึง <strong>${Math.round((maxVal/avg-1)*100)}%</strong>
        ควรเพิ่มเจ้าหน้าที่และเปิดช่องทางเข้าชมให้เพียงพอในช่วงนี้
      </div>
    </div>
    <div class="analysis-card">
      <div class="analysis-card-title">📉 เดือนที่ผู้เยี่ยมชมน้อยที่สุด</div>
      <div class="analysis-card-body">
        <strong>${minM.month} — ${minVal.toLocaleString()} คน</strong><br>
        ${minM.note} ยอดต่ำกว่าค่าเฉลี่ย <strong>${Math.round((1-minVal/avg)*100)}%</strong>
        เหมาะสำหรับการซ่อมบำรุงและฝึกอบรมเจ้าหน้าที่ประจำปี
      </div>
    </div>
    <div class="analysis-card">
      <div class="analysis-card-title">📊 แนวโน้มและฤดูกาล</div>
      <div class="analysis-card-body">
        พบ <strong>3 ช่วงพีค</strong> ชัดเจน: <strong>เม.ย.</strong> (สงกรานต์),
        <strong>พ.ย.</strong> (เทศกาลแสงสีเสียง) และ <strong>ธ.ค.</strong> (ปีใหม่)
        ช่วง <strong>มิ.ย.–ส.ค.</strong> เป็น Low Season ฝนตก ยอดดิ่งลงต่ำสุด
      </div>
    </div>
    <div class="analysis-card">
      <div class="analysis-card-title">📈 ภาพรวมทั้งปี</div>
      <div class="analysis-card-body">
        รวม <strong>${total.toLocaleString()} คน</strong> · เฉลี่ย <strong>${avg.toLocaleString()} คน/เดือน</strong><br>
        เติบโต <strong>${yoy}</strong> เทียบปีก่อน · สัดส่วน High Season (เม.ย., ต.ค.–ธ.ค.)
        คิดเป็น <strong>${Math.round(([24310,19430,22150,21080].reduce((a,b)=>a+b,0)/total)*100)}%</strong> ของยอดทั้งปี
      </div>
    </div>
  `;
}


function addNotif(data) {
  const panel = document.getElementById('notifList');
  if (!panel) return;
  const card = buildNotifCard(data);
  panel.insertBefore(card, panel.firstChild);
}

function nowStr() {
  const now = new Date();
  return now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
}

/* ================================================================
   16. MANUAL CONTROLS (ปุ่มในหน้า dashboard)
================================================================ */
// ปุ่มทดสอบส่ง LINE
document.getElementById('testLineBtn')?.addEventListener('click', () => {
  showToast('💬 LINE ทดสอบ', 'ส่งการแจ้งเตือนทดสอบไปยังเจ้าหน้าที่ทุกคนแล้ว');
  addNotif({
    color: 'line', icon: '💬', badge: 'badge-line', badgeText: 'LINE',
    title: 'ทดสอบ: ระบบส่ง LINE ทำงานปกติ',
    body: 'ส่งข้อความทดสอบไปยังกลุ่ม LINE เจ้าหน้าที่ทุกคนแล้ว',
    time: nowStr(), hasLine: false, actions: ['รับทราบ']
  });
});

// ปุ่ม Emergency Alert
document.getElementById('emergencyBtn')?.addEventListener('click', () => {
  if (!confirm('⚠️ ยืนยันการส่งสัญญาณฉุกเฉินไปยังเจ้าหน้าที่ทุกคน?')) return;
  showToast('🚨 Emergency Alert', 'ส่งสัญญาณฉุกเฉินไปยังเจ้าหน้าที่ทุกคนทาง LINE แล้ว!', 8000);
  addNotif({
    color: 'red', icon: '🚨', badge: 'badge-red', badgeText: 'ฉุกเฉิน',
    title: 'ส่งสัญญาณฉุกเฉิน — เจ้าหน้าที่ทุกคน',
    body: 'แจ้งเตือนฉุกเฉินถูกส่งไปยัง LINE ของเจ้าหน้าที่ทุกคนแล้ว กรุณาไปยังจุดรวมพล',
    time: nowStr(), hasLine: true, lineMsg: 'แจ้งเจ้าหน้าที่ทุกคน — ฉุกเฉิน',
    actions: ['ยืนยันรับ']
  });
});