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
  onScroll();
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

  function visibleCount() {
    if (window.innerWidth < 640) return 1;
    if (window.innerWidth < 900) return 2;
    return 3;
  }

  function slideStep() {
    const gap = 20;
    const vc  = visibleCount();
    const w   = track.parentElement.offsetWidth;
    return (w - gap * (vc - 1)) / vc + gap;
  }

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
   7. OPEN CHAT BUTTONS — wire to Botpress widget
---------------------------------------------------------------- */
(function initOpenChatButtons() {
  function openBot() {
    if (window.botpress && typeof window.botpress.open === 'function') {
      window.botpress.open();
    }
  }
  ['openChatBtn', 'openChatNav'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', e => {
      e.preventDefault();
      openBot();
    });
  });
})();

/* ----------------------------------------------------------------
   8. LIGHTBOX
---------------------------------------------------------------- */
(function initLightbox() {
  const overlay  = document.getElementById('lightboxOverlay');
  const img      = document.getElementById('lightboxImg');
  const caption  = document.getElementById('lightboxCaption');
  const desc     = document.getElementById('lightboxDesc');
  const counter  = document.getElementById('lightboxCounter');
  const closeBtn = document.getElementById('lightboxClose');
  const prevBtn  = document.getElementById('lightboxPrev');
  const nextBtn  = document.getElementById('lightboxNext');
  if (!overlay) return;

  const slides = [...document.querySelectorAll('.carousel-slide[data-src]')];
  let current = 0;

  function open(index) {
    current = index;
    const slide = slides[current];
    img.src = slide.dataset.src;
    img.alt = slide.querySelector('img').alt;
    caption.textContent = slide.dataset.caption || '';
    desc.textContent    = slide.dataset.desc || '';
    counter.textContent = `${current + 1} / ${slides.length}`;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    img.src = '';
  }

  function prev() { open((current - 1 + slides.length) % slides.length); }
  function next() { open((current + 1) % slides.length); }

  slides.forEach((slide, i) => slide.addEventListener('click', () => open(i)));
  closeBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  document.addEventListener('keydown', e => {
    if (!overlay.classList.contains('open')) return;
    if (e.key === 'Escape')     close();
    if (e.key === 'ArrowLeft')  prev();
    if (e.key === 'ArrowRight') next();
  });

  let touchStartX = 0;
  overlay.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  overlay.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) dx < 0 ? next() : prev();
  }, { passive: true });
})();

/* ----------------------------------------------------------------
   9. CONTACT FORM — mock submit
---------------------------------------------------------------- */
(function initContactForm() {
  const btn = document.getElementById('formSubmitBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.textContent = 'กำลังส่ง...';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = 'ส่งข้อความสำเร็จ — เราจะตอบกลับภายใน 24 ชั่วโมง';
      btn.style.background = '#16a34a';
      setTimeout(() => {
        btn.textContent = 'ส่งข้อความ';
        btn.style.background = '';
        btn.disabled = false;
      }, 4500);
    }, 1800);
  });
})();
