/* ── Loading progress sync ─────────────────────────────────── */
const loadingTextEl = document.getElementById('loading-text');
const loadingPctEl = document.getElementById('loading-pct');
const barFill = document.getElementById('loading-bar-fill');
let revealDone = false;

function onLoadComplete() {
    if (revealDone) return;
    revealDone = true;
    const brandLink = document.getElementById('letters4u-link');
    if (brandLink) brandLink.hidden = false;
    const loadingEl = document.getElementById('loading');

    // 1️⃣ Fade out the clean dark loading screen
    if (loadingEl) {
        loadingEl.style.opacity = '0';
        setTimeout(() => loadingEl.remove(), 750);
    }

    // 2️⃣ Fade in the masonry bg images (after loading screen starts fading)
    setTimeout(() => {
        const heroBg = document.getElementById('hero-bg');
        if (heroBg) heroBg.classList.add('visible');
    }, 300);

    // 3️⃣ hero-ui show() is called by main.js after the 3D model finishes
    //     its slide-up entrance animation — no need to do it here.
}

const loadingObs = new MutationObserver(() => {
    const raw = loadingTextEl?.textContent || '';
    const match = raw.match(/(\d+)/);
    if (!match) return;
    const pct = parseInt(match[1]);
    if (loadingPctEl) loadingPctEl.textContent = pct + '%';
    if (barFill) barFill.style.width = pct + '%';
    if (pct >= 100) {
        // Reveal only after the model and all gallery pictures are ready.
        loadingObs.disconnect(); // Stop watching — no more updates needed
    }
});
loadingObs.observe(loadingTextEl, { childList: true, characterData: true, subtree: true });
window.addEventListener('gallery-ready', onLoadComplete, { once: true });

/* ── Show scroll hint after flash resolves ───────────────── */
const flashEl = document.getElementById('white-flash');
const scrollHint = document.getElementById('scroll-hint');

new MutationObserver(() => {
    const opacity = parseFloat(flashEl.style.opacity || 0);
    if (opacity === 0 && flashEl.dataset.flashed === 'true')
        setTimeout(() => scrollHint?.classList.add('show'), 800);
    if (opacity === 1) flashEl.dataset.flashed = 'true';
}).observe(flashEl, { attributes: true, attributeFilter: ['style'] });

/* ── First interaction: hide hero text overlay ────────────── */
function hideHero() {
    const brandLink = document.getElementById('letters4u-link');
    if (brandLink) brandLink.hidden = true;
    const startHint = document.getElementById('start-hint');
    if (startHint) startHint.hidden = true;
    const hero = document.getElementById('hero-ui');
    if (hero) {
        hero.style.opacity = '0';
        setTimeout(() => hero.remove(), 1000);
    }
}
window.addEventListener('gallery-start', hideHero, { once: true });

/* ── Hide scroll hint on first scroll ─────────────────────── */
window.addEventListener('scroll', () => {
    if (scrollHint) {
        scrollHint.style.opacity = '0';
        setTimeout(() => scrollHint.remove(), 1000);
    }
}, { once: true, passive: true });
