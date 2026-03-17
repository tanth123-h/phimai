/* ================================================================
   PHIMAI HISTORICAL PARK — JavaScript หลัก (หน้าสาธารณะ)
   ไฟล์: js/main.js
================================================================ */

/* ----------------------------------------------------------------
   1. NAVBAR — เปลี่ยนสีเมื่อ scroll
---------------------------------------------------------------- */
(function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;
  const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 60);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // เรียกทันทีเผื่อโหลดหน้าแบบ anchored
})();

/* ----------------------------------------------------------------
   2. HERO — zoom-out animation เมื่อโหลดหน้า
---------------------------------------------------------------- */
(function initHero() {
  const bg = document.getElementById('heroBg');
  if (bg) window.addEventListener('load', () => bg.classList.add('loaded'));
})();

/* ----------------------------------------------------------------
   3. MOBILE MENU
---------------------------------------------------------------- */
(function initMobileMenu() {
  const hamburger  = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  const closeBtn   = document.getElementById('mobileClose');
  if (!hamburger || !mobileMenu) return;

  hamburger.addEventListener('click', () => mobileMenu.classList.add('open'));
  closeBtn?.addEventListener('click', () => mobileMenu.classList.remove('open'));
  mobileMenu.querySelectorAll('a').forEach(link =>
    link.addEventListener('click', () => mobileMenu.classList.remove('open'))
  );
})();

/* ----------------------------------------------------------------
   4. REVEAL ON SCROLL (Intersection Observer)
---------------------------------------------------------------- */
(function initReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
})();

/* ----------------------------------------------------------------
   5. CAROUSEL
---------------------------------------------------------------- */
(function initCarousel() {
  const track    = document.getElementById('carouselTrack');
  const dotsWrap = document.getElementById('carouselDots');
  const prevBtn  = document.getElementById('prevBtn');
  const nextBtn  = document.getElementById('nextBtn');
  if (!track) return;

  const slides = [...track.querySelectorAll('.carousel-slide')];
  let current = 0;
  let autoTimer;

  /** จำนวน slide ที่แสดงพร้อมกัน */
  function visibleCount() {
    if (window.innerWidth < 640) return 1;
    if (window.innerWidth < 900) return 2;
    return 3;
  }

  /** ความกว้างต่อ 1 step การเลื่อน */
  function slideStep() {
    const gap = 20;
    const vc  = visibleCount();
    const w   = track.parentElement.offsetWidth;
    return (w - gap * (vc - 1)) / vc + gap;
  }

  /** สร้าง dot */
  function buildDots() {
    if (!dotsWrap) return;
    const count = Math.max(1, slides.length - visibleCount() + 1);
    dotsWrap.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className = 'carousel-dot' + (i === current ? ' active' : '');
      d.addEventListener('click', () => goTo(i));
      dotsWrap.appendChild(d);
    }
  }

  function updateDots() {
    dotsWrap?.querySelectorAll('.carousel-dot').forEach((d, i) =>
      d.classList.toggle('active', i === current)
    );
  }

  function goTo(index) {
    const max = Math.max(0, slides.length - visibleCount());
    current = Math.max(0, Math.min(index, max));
    track.style.transform = `translateX(-${current * slideStep()}px)`;
    updateDots();
  }

  prevBtn?.addEventListener('click', () => { goTo(current - 1); resetAuto(); });
  nextBtn?.addEventListener('click', () => { goTo(current + 1); resetAuto(); });

  function startAuto() {
    autoTimer = setInterval(() => {
      const max = slides.length - visibleCount();
      goTo(current < max ? current + 1 : 0);
    }, 3800);
  }
  function resetAuto() { clearInterval(autoTimer); startAuto(); }

  window.addEventListener('resize', () => { buildDots(); goTo(current); });
  buildDots();
  startAuto();
})();

/* ----------------------------------------------------------------
   6. SMOOTH ANCHOR SCROLL
---------------------------------------------------------------- */
(function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
})();

/* ----------------------------------------------------------------
   7. CHATBOT AI
   แก้ไขคำตอบได้ใน chatKnowledge ด้านล่าง
---------------------------------------------------------------- */
(function initChatbot() {
  /* ---- ฐานความรู้ ---- */
  /* แก้ไขคำถาม/คำตอบได้ที่นี่ */
  const chatKnowledge = [
    {
      id: 'hours',
      triggers: ['เปิด', 'ปิด', 'เวลา', 'กี่โมง', 'opening', 'hour', 'close', 'open'],
      answer: '🕐 อุทยานประวัติศาสตร์พิมาย เปิดให้บริการทุกวัน\n• เวลา 07:00 – 18:00 น.\n• พิพิธภัณฑ์แห่งชาติพิมาย: 09:00 – 16:00 น.\n\nแนะนำให้มาแต่เช้าเพื่อสัมผัสบรรยากาศก่อนที่จะร้อน 🌤️'
    },
    {
      id: 'ticket',
      triggers: ['ค่าเข้า', 'ราคา', 'ตั๋ว', 'บาท', 'ticket', 'price', 'fee', 'cost', 'admission'],
      answer: '🎟️ ค่าเข้าชม:\n• ชาวไทย: 20 บาท\n• ชาวต่างชาติ: 100 บาท\n• เด็กอายุต่ำกว่า 15 ปี: ฟรี\n\nซื้อตั๋วได้ที่ช่องจำหน่ายหน้าประตูทางเข้า ไม่ต้องจองล่วงหน้า'
    },
    {
      id: 'history',
      triggers: ['ประวัติ', 'ความเป็นมา', 'สร้าง', 'ขอม', 'history', 'built', 'khmer', 'king'],
      answer: '📜 ปราสาทหินพิมายสร้างขึ้นในพุทธศตวรรษที่ 16–17 สมัยพระเจ้าชัยวรมันที่ 6 แห่งอาณาจักรเขมร\n\nถือเป็นต้นแบบของนครวัด (Angkor Wat) ในกัมพูชา มีชื่อโบราณว่า "วิมายปุระ" หรือ "วิมาย" เป็นปลายทางของเส้นทางราชมรรคา ระยะทาง 225 กม. จากนครวัด'
    },
    {
      id: 'directions',
      triggers: ['ไป', 'เดินทาง', 'รถ', 'บัส', 'วิธี', 'direction', 'bus', 'car', 'how to get', 'travel'],
      answer: '🗺️ การเดินทาง:\n🚌 รถโดยสาร: จากขนส่งโคราช ออกทุก 30 นาที ใช้เวลา ~1 ชั่วโมง\n🚗 รถยนต์: ทางหลวง 2 → ทางหลวง 206 ระยะทาง 60 กม.\n🅿️ มีที่จอดรถฟรีบริเวณทางเข้า\n🚆 รถไฟ: กรุงเทพฯ → โคราช (~3.5 ชม.) แล้วต่อรถสองแถว'
    },
    {
      id: 'attractions',
      triggers: ['ดู', 'ที่ท่องเที่ยว', 'สถานที่', 'ไฮไลท์', 'see', 'attraction', 'highlight', 'visit'],
      answer: '🏛️ สิ่งที่ไม่ควรพลาด:\n• ปรางค์ประธาน — หอคอยกลางสูงตระหง่าน\n• สะพานนาคราช — พญานาค 7 เศียรตั้งเฝ้า\n• โคปุระด้านใต้ — ประตูทางเข้าหันหน้าสู่นครวัด\n• ปรางค์พรหมทัต — ปรางค์ข้างสีน้ำตาลแดง\n\n📍 ใกล้เคียง: สระสีงาม (ต้นไทรยักษ์) ห่างแค่ 800 ม.'
    },
    {
      id: 'smartflow',
      triggers: ['ai', 'สมาร์ท', 'กล้อง', 'ระบบ', 'แจ้ง', 'line', 'ไลน์', 'smartflow'],
      answer: '🤖 SmartFlow AI คือระบบตรวจจับฝูงชนด้วย AI ของเราเอง!\n\n📷 กล้อง AI วิเคราะห์ความหนาแน่นผู้เข้าชมแบบ Real-time\n📱 ส่งการแจ้งเตือนผ่าน LINE ให้เจ้าหน้าที่ทันทีเมื่อพื้นที่แน่น\n🛍️ แจ้งผู้ค้าแผงลอยใกล้เคียงในวันที่มีผู้เยี่ยมชมมาก\n🧓 ตรวจจับผู้สูงอายุหรือผู้ที่ต้องการความช่วยเหลือ'
    },
    {
      id: 'food',
      triggers: ['อาหาร', 'กิน', 'ร้าน', 'ตลาด', 'food', 'eat', 'restaurant', 'market'],
      answer: '🍜 ร้านอาหารและของกิน:\n• ตลาดกลางคืนพิมาย — ห่าง 500 ม. อาหารอร่อยราคาย่อมเยา\n• ร้านอาหารท้องถิ่นรอบๆ จัตุรัสเมือง\n• แผงค้าหน้าทางเข้าอุทยาน\n• บริเวณสระสีงาม มีร้านขายของว่าง\n\n💡 ระบบ SmartFlow AI จะแจ้งผู้ค้าให้มาตั้งแผงล่วงหน้าในวันที่คนพลุกพล่าน!'
    },
    {
      id: 'parking',
      triggers: ['จอด', 'ที่จอด', 'รถยนต์', 'parking', 'car park'],
      answer: '🅿️ มีที่จอดรถฟรีติดกับประตูทางเข้าหลัก รองรับได้ทั้งรถยนต์และมอเตอร์ไซค์ ในวันที่มีผู้เยี่ยมชมมาก จะมีการจัดพื้นที่จอดรถเพิ่มเติมบริเวณใกล้เคียง'
    },
  ];

  const defaultAnswer = '🙏 ขอบคุณสำหรับคำถามนะคะ ตอนนี้ยังไม่มีข้อมูลเรื่องนี้\nสามารถโทรสอบถามได้ที่ 044-471 568 หรือส่ง LINE มาที่ @PhimaiHistoricalPark ได้เลยค่ะ';

  function getAnswer(text) {
    const lower = text.toLowerCase();
    for (const entry of chatKnowledge) {
      if (entry.triggers.some(t => lower.includes(t))) return entry.answer;
    }
    return defaultAnswer;
  }

  /* ---- DOM ---- */
  const chatMessages = document.getElementById('chatMessages');
  const chatInput    = document.getElementById('chatInput');
  if (!chatMessages || !chatInput) return;

  function nowTime() {
    const n = new Date();
    return n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
  }

  function appendMsg(text, role) {
    const row = document.createElement('div');
    row.className = `msg-row ${role}`;

    const av = document.createElement('div');
    av.className = 'msg-avatar-sm';
    av.textContent = role === 'bot' ? '🤖' : '👤';

    const wrapper = document.createElement('div');
    const bubble  = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = text.replace(/\n/g, '<br>');

    const time = document.createElement('div');
    time.className = 'msg-time';
    time.textContent = nowTime();

    wrapper.appendChild(bubble);
    wrapper.appendChild(time);
    row.appendChild(av);
    row.appendChild(wrapper);
    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  let typingRow = null;
  function showTyping() {
    typingRow = document.createElement('div');
    typingRow.className = 'msg-row bot';
    const av  = document.createElement('div');
    av.className = 'msg-avatar-sm';
    av.textContent = '🤖';
    const ind = document.createElement('div');
    ind.className = 'typing-indicator';
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'typing-dot';
      ind.appendChild(d);
    }
    typingRow.appendChild(av);
    typingRow.appendChild(ind);
    chatMessages.appendChild(typingRow);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  function removeTyping() { typingRow?.remove(); typingRow = null; }

  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    appendMsg(text, 'user');
    showTyping();
    setTimeout(() => {
      removeTyping();
      appendMsg(getAnswer(text), 'bot');
    }, 800 + Math.random() * 600);
  }

  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
  document.getElementById('chatSendBtn')?.addEventListener('click', sendMessage);

  /* expose ให้ onclick ใน HTML ใช้ได้ */
  window.sendChatQuick = (text) => {
    chatInput.value = text;
    sendMessage();
  };
})();

/* ----------------------------------------------------------------
   8. CONTACT FORM — mock submit
---------------------------------------------------------------- */
(function initContactForm() {
  const btn = document.getElementById('formSubmitBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.textContent = 'กำลังส่ง...';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = '✓ ส่งข้อความแล้ว! เราจะตอบกลับภายใน 24 ชั่วโมง';
      btn.style.background = '#16a34a';
      setTimeout(() => {
        btn.textContent = 'ส่งข้อความ →';
        btn.style.background = '';
        btn.disabled = false;
      }, 4500);
    }, 1800);
  });
})();
