/**
 * QUANTUM DREAMSCAPE – ADVANCED FEATURES MODULE
 * game-features.js
 *
 * Architecture:
 *  - Base game's animate() checks window.advPaused → stops when true
 *  - This module runs its own rAF loop ONLY when paused (draws zero-G world)
 *  - Player.prototype.draw is overridden → enhanced robot replaces simple rect
 *  - All other features (laser, diamonds, HUD) layer on top via event hooks
 */

(function () {
    'use strict';

    /* ================================================================
       WAIT FOR BASE GAME (polls until key globals exist)
       ================================================================ */
    function waitForGame(cb) {
        if (window.state && window.Player && window.animate && window.GameEffects) {
            cb();
        } else {
            setTimeout(() => waitForGame(cb), 80);
        }
    }

    /* ================================================================
       ADVANCED STATE
       ================================================================ */
    const adv = {
        diamonds:      0,
        coins:         0,
        paused:        false,
        pauseFrame:    0,

        laserCooldown: 0,
        LASER_CD:      16,   // frames between shots

        lastCloseFrame: -999,
        CLOSE_DIST:     120, // px to trigger slow-mo / cinematic zoom

        burningAsteroids: new Set(),
    };

    /* ================================================================
       DOM SETUP
       ================================================================ */
    function buildDOM() {
        /* ---- Advanced HUD (top-right) ---- */
        const hud = el('div', { id: 'advHud', 'class': 'overlay hidden' });
        hud.innerHTML = `
            <div class="hud-row" id="diamondRow">
                <span class="hud-icon">💎</span>
                <span class="hud-value" id="diamondCount">0</span>
            </div>
            <div class="hud-row" id="coinRow">
                <span class="hud-icon" style="font-size:1rem;background:rgba(0,80,200,0.4);border:1px solid #ffd700;border-radius:4px;padding:2px 6px;color:#ffd700;font-family:'Orbitron',sans-serif;font-size:0.75rem;">IEEE</span>
                <span class="hud-value" id="coinCount">0</span>
            </div>
            <div class="hud-row" id="speedRow">
                <span class="hud-icon">⚡</span>
                <span class="hud-value" id="speedVal">1.0×</span>
            </div>
            <div class="hud-row" id="distRow">
                <span class="hud-icon">🚀</span>
                <span class="hud-value" id="distVal">0 AU</span>
            </div>
        `;
        document.body.appendChild(hud);

        /* ---- Pause button (top-left) ---- */
        const pauseBtn = el('button', { id: 'pauseBtn', 'class': 'overlay hidden', title: 'Pause (P)' });
        pauseBtn.textContent = '⏸';
        document.body.appendChild(pauseBtn);

        /* ---- Laser flash ---- */
        document.body.appendChild(el('div', { id: 'laserFlash' }));

        /* ---- Slow-mo indicator ---- */
        const smi = el('div', { id: 'slowMoIndicator' });
        smi.textContent = '⚠ PROXIMITY ALERT — SLOW TIME ⚠';
        document.body.appendChild(smi);

        /* ---- Targeting reticle ---- */
        document.body.appendChild(el('div', { id: 'targetingReticle' }));

        /* ---- Zero-G badge ---- */
        const badge = el('div', { id: 'zeroGBadge' });
        badge.textContent = '🌌  ZERO GRAVITY ACTIVE  🌌';
        document.body.appendChild(badge);

        const overlay = el('div', { id: 'pauseOverlay' });
        overlay.innerHTML = `
            <style>
              @keyframes floatText { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-15px); } }
              .pause-title { animation: floatText 4s infinite ease-in-out; text-shadow: 0 0 20px #00f2fe; }
            </style>
            <div class="zero-g-wrapper">
                <div class="pause-title">PAUSED</div>
                <div class="pause-subtitle">— ZERO GRAVITY MODE —</div>
                <p class="zero-g-info">All systems floating freely…</p>
                <button class="resume-btn" id="resumeBtn">▶ &nbsp;RESUME</button>
                <p class="zero-g-info" style="font-size:.75rem;opacity:.45;margin-top:8px;">Press P to resume</p>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    function el(tag, attrs) {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        return e;
    }

    /* ================================================================
       PAUSE / RESUME
       ================================================================ */
    function pause() {
        if (adv.paused || !window.state || window.state.status !== 'playing') return;
        adv.paused = true;
        window.advPaused = true;
        adv.pauseFrame = 0;

        snapshotFloats();

        document.getElementById('pauseOverlay').classList.add('active');
        document.getElementById('zeroGBadge').classList.add('active');
        document.getElementById('pauseBtn').textContent = '▶';
        document.getElementById('gameCanvas').classList.add('zero-g-active');

        window.GameEffects.spawnZeroGOrbs();
        startPauseRenderLoop();
    }

    function resume() {
        if (!adv.paused) return;
        adv.paused = false;
        window.advPaused = false;

        restoreFromSnapshot();

        document.getElementById('pauseOverlay').classList.remove('active');
        document.getElementById('zeroGBadge').classList.remove('active');
        document.getElementById('pauseBtn').textContent = '⏸';
        document.getElementById('gameCanvas').classList.remove('zero-g-active');

        window.GameEffects.clearZeroGOrbs();
        snapBackBurst();
    }

    /* ================================================================
       FLOAT SNAPSHOTS (zero-G entity drift during pause)
       ================================================================ */
    const floats = {
        player:    null,   // { x, y, vx, vy, spin, angle }
        platforms: [],     // array of { origY, offsetY, vy, phase }
        asteroids: [],     // array of { x, y, vx, vy, spin, angle }
    };

    function snapshotFloats() {
        const p = window.player;
        floats.player = p ? {
            x: p.x, y: p.y,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -0.4 - Math.random() * 0.3,
            spin: (Math.random() - 0.5) * 0.04,
            angle: 0
        } : null;

        floats.platforms = (window.platforms || []).map((pl, i) => ({
            origX: pl.x, origY: pl.y,
            dx: 0, dy: 0,
            vy: -0.25 - Math.random() * 0.22,
            vx: (Math.random() - 0.5) * 0.1,
            phase: i * 0.9
        }));

        // Works for both old asteroids and new Planet objects
        floats.asteroids = (window.asteroids || []).map((a, i) => ({
            x: a.x, y: (a.y !== undefined ? a.y : (a.r ? (window.innerHeight - 90 - a.r) : 300)),
            vx: (Math.random() - 0.5) * 1.5,
            vy: (Math.random() - 0.5) * 1.5 - 0.5,
            spin: (Math.random() - 0.5) * 0.08,
            angle: 0,
            phase: i * 1.3
        }));
    }

    function tickFloats() {
        const f = adv.pauseFrame;
        const C = document.getElementById('gameCanvas');
        const H = C ? C.height : window.innerHeight;
        const W = C ? C.width  : window.innerWidth;

        /* Player */
        if (floats.player && window.player) {
            const fp = floats.player;
            fp.x    += fp.vx;
            fp.y    += fp.vy;
            fp.angle += fp.spin;
            // gentle wave on top of drift
            window.player.x = fp.x + Math.sin(f * 0.03 + 1.2) * 4;
            window.player.y = Math.max(30, Math.min(H - 80, fp.y + Math.cos(f * 0.025) * 3));
        }

        /* Platforms */
        const plts = window.platforms || [];
        floats.platforms.forEach((fp, i) => {
            if (i >= plts.length) return;
            fp.dx += fp.vx;
            fp.dy += fp.vy;
            plts[i].y = fp.origY + fp.dy + Math.sin(f * 0.022 + fp.phase) * 7;
        });

        /* Asteroids */
        const asts = window.asteroids || [];
        floats.asteroids.forEach((fa, i) => {
            if (i >= asts.length) return;
            fa.x += fa.vx;
            fa.y += fa.vy;
            fa.angle += fa.spin;
            asts[i].x = fa.x + Math.sin(f * 0.04 + fa.phase) * 5;
            asts[i].y = fa.y + Math.cos(f * 0.035 + fa.phase) * 4;
            asts[i]._zeroGAngle = fa.angle;

            // wrap y
            if (asts[i].y < -50)  { fa.y += H + 100; asts[i].y = fa.y; }
            if (asts[i].y > H+50) { fa.y -= H + 100; asts[i].y = fa.y; }
        });
    }

    function restoreFromSnapshot() {
        // Platforms: restore y positions so player doesn't instantly miss them
        const plts = window.platforms || [];
        floats.platforms.forEach((fp, i) => {
            if (i >= plts.length) return;
            plts[i].y = fp.origY;      // snap back to original y
        });

        // Player velocity reset so no lingering drift
        if (window.player) {
            window.player.vy = 0;
        }
    }

    function snapBackBurst() {
        const p = window.player;
        if (!p || !window.particles || !window.Particle) return;
        for (let i = 0; i < 24; i++) {
            window.particles.push(
                new window.Particle(p.x + 18, p.y + 26,
                    i % 2 === 0 ? '#00f2fe' : '#ff00ff')
            );
        }
    }

    /* ================================================================
       PAUSE-TIME RENDER LOOP
       (runs only while paused; draws zero-G world each frame)
       ================================================================ */
    let _pauseLoopActive = false;

    function startPauseRenderLoop() {
        _pauseLoopActive = true;
        pauseRenderLoop();
    }

    function pauseRenderLoop() {
        if (!adv.paused) { _pauseLoopActive = false; return; }
        requestAnimationFrame(pauseRenderLoop);

        tickFloats();
        adv.pauseFrame++;

        const canvas = document.getElementById('gameCanvas');
        const ctx    = canvas.getContext('2d');

        // Always draw space background so stars/nebula stay visible
        if (window.drawImpastoBackground) window.drawImpastoBackground();

        // Pause overlay dim for clarity (lowered alpha to make background much more visible)
        ctx.fillStyle = 'rgba(0,10,30,0.1)';
        ctx.fillRect(0,0,canvas.width,canvas.height);

        // Draw platforms (floating up gently)
        (window.platforms || []).forEach(p => { if (p.draw) p.draw(); });

        // Draw planets/asteroids with zero-G spin using their own draw()
        (window.asteroids || []).forEach(ast => {
            if (ast.draw) {
                // temporarily override y to use float position
                ast.draw();
            } else {
                ctx.save();
                ctx.translate(ast.x, ast.y);
                ctx.rotate(ast._zeroGAngle || 0);
                const r = ast.radius || ast.r || 20;
                const palS = (ast.pal && ast.pal.s) || '#ff6633';
                ctx.shadowColor = palS; ctx.shadowBlur = 16;
                ctx.fillStyle = (ast.pal && ast.pal.b) || '#cc3311';
                ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
        });

        // IEEE coins floating
        if (window.coins) window.coins.forEach(c => { if (c.draw) c.draw(); });

        // Particles
        (window.particles || []).forEach(pt => { if (pt.draw) pt.draw(); });

        // Player robot — use shared drawCanvasRobot with zero-G flag
        if (window.player && window.drawCanvasRobot) {
            window.drawCanvasRobot(
                ctx, window.player.x, window.player.y,
                adv.pauseFrame, true, false  // isZeroG=true
            );
        }

        // Floating glowing orbs on top
        window.GameEffects.drawZeroGOrbs(adv.pauseFrame);
    }

    /* ================================================================
       PLAYER DRAW OVERRIDE
       (runs every frame during normal gameplay via base game)
       ================================================================ */
    function overridePlayerDraw() {
        // Player.draw() in index.html already calls drawCanvasRobot directly —
        // no prototype override needed. GameEffects.drawRobot also delegates to
        // drawCanvasRobot, so both paths are consistent.
        if (window.Player && window.Player.prototype) {
            window.Player.prototype.draw = function () {
                const frame = (window.state && window.state.frames) || 0;
                window.drawCanvasRobot(
                    document.getElementById('gameCanvas').getContext('2d'),
                    this.x, this.y, frame, this.grounded, false
                );
            };
        }
    }

    /* ================================================================
       LASER SYSTEM
       ================================================================ */
    function fireLaser() {
        if (!window.state || window.state.status !== 'playing') return;
        if (adv.paused) return;
        if (adv.laserCooldown > 0) return;

        const p    = window.player;
        if (!p) return;

        // Gun mount: left-arm cannon tip of the draw-robot space
        const fromX = p.x - 12;
        const fromY = p.y + p.h * 0.65;

        // Find nearest asteroid
        const asts   = window.asteroids || [];
        let nearest  = null;
        let minDist  = Infinity;
        for (const a of asts) {
            const d = Math.hypot(a.x - fromX, a.y - fromY);
            if (d < minDist) { minDist = d; nearest = a; }
        }

        if (nearest) {
            window.GameEffects.fireLaser(fromX, fromY, nearest.x, nearest.y);
            destroyAsteroid(nearest);
        } else {
            // Fire forward through empty space
            window.GameEffects.fireLaser(fromX, fromY, window.innerWidth + 100, fromY);
        }

        adv.laserCooldown = adv.LASER_CD;
        playLaserSfx();
    }

    function destroyAsteroid(ast) {
        const asts = window.asteroids || [];
        const idx  = asts.indexOf(ast);
        if (idx === -1) return;

        // Use ast.r since TrueAsteroid defines `r`
        window.GameEffects.createExplosion(ast.x, ast.y, ast.r || 25);
        if (window.showExclamation) window.showExclamation(ast.x, ast.y, "BOOM!", "#ff5500");
        if (window.state) window.state.shake = 16;
        awardDiamond(ast.x, ast.y);
        asts.splice(idx, 1);
    }

    /* ================================================================
       CLOSE-ENCOUNTER (near-miss slow-mo + coin reward)
       ================================================================ */
    function checkProximity() {
        const p    = window.player;
        const asts = window.asteroids || [];
        const frame = (window.state && window.state.frames) || 0;
        if (!p) return;

        let nearestDist   = Infinity;
        let nearestTarget = null;

        for (const ast of asts) {
            // Target tracking for flying asteroids
            const nearX = Math.max(p.x, Math.min(ast.x, p.x + p.w));
            const nearY = Math.max(p.y, Math.min(ast.y, p.y + p.h));
            const d     = Math.hypot(ast.x - nearX, ast.y - nearY);

            if (d < nearestDist) { nearestDist = d; nearestTarget = ast; }
        }

        // Show targeting reticle on nearest threatening asteroid
        if (nearestTarget && nearestDist < adv.CLOSE_DIST * 2.5) {
            window.GameEffects.showTargetReticle(nearestTarget.x, nearestTarget.y);
        } else {
            window.GameEffects.hideTargetReticle();
        }

        // Trigger slow-mo + cinematic zoom on very close encounter
        if (nearestDist < adv.CLOSE_DIST && (frame - adv.lastCloseFrame) > 200) {
            adv.lastCloseFrame = frame;
            window.GameEffects.activateSlowMo(90); // ~1.5s
        }

        // Apply cinematic zoom via CSS on canvas
        applyCinematicZoom();
    }

    function applyCinematicZoom() {
        const zoom   = window.GameEffects.getZoom();
        const canvas = document.getElementById('gameCanvas');
        const p      = window.player;
        if (!canvas || !p) return;

        if (Math.abs(zoom - 1.0) > 0.005) {
            canvas.style.transform       = `scale(${zoom})`;
            canvas.style.transformOrigin = `${p.x}px ${p.y + p.h / 2}px`;
            canvas.style.transition      = 'transform 0.35s ease';
        } else {
            canvas.style.transform  = 'none';
            canvas.style.transition = 'transform 0.5s ease';
        }
    }

    /* ================================================================
       DIAMONDS & COINS
       ================================================================ */
    function awardDiamond(worldX, worldY) {
        adv.diamonds++;
        window.GameEffects.createSparkle(worldX, worldY);
        updateHUD();
        bumpCounter('diamondCount');
        playDiamondSfx();
    }

    function awardCoin() {
        adv.coins++;
        // Show IEEE collect text near player
        const p = window.player;
        if (p && window._showIEEECoinText) {
            window._showIEEECoinText(p.x + 20, p.y - 10);
        }
        updateHUD();
        bumpCounter('coinCount');
    }

    function bumpCounter(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.transition = 'none';
        el.style.transform  = 'scale(1.6) translateX(-4px)';
        el.style.color      = '#ffffff';
        setTimeout(() => {
            el.style.transition = 'all 0.35s ease';
            el.style.transform  = 'scale(1)';
            el.style.color      = '';
        }, 120);
    }

    /* ================================================================
       HUD UPDATER
       ================================================================ */
    function updateHUD() {
        const dc = document.getElementById('diamondCount'); if (dc) dc.textContent = adv.diamonds;
        const cc = document.getElementById('coinCount');    if (cc) cc.textContent = adv.coins;

        if (window.state) {
            const sp = document.getElementById('speedVal');
            if (sp) sp.textContent = `${(window.state.currentSpeed / Math.max(1, window.state.baseSpeed)).toFixed(1)}×`;
            const dt = document.getElementById('distVal');
            if (dt) dt.textContent = `${Math.floor(window.state.distance / 10)} AU`;
        }
    }

    function showAdvHUD() {
        const hud = document.getElementById('advHud');
        const btn = document.getElementById('pauseBtn');
        // Hide original score HUD to avoid duplicate info
        const origHud = document.getElementById('hud');
        if (origHud && !origHud.classList.contains('hidden')) origHud.classList.add('hidden');
        if (hud) hud.classList.remove('hidden');
        if (btn) btn.classList.remove('hidden');
    }

    /* ================================================================
       POST-RENDER HOOK
       (called each frame during gameplay to draw effects on top)
       ================================================================ */
    function postRenderHook() {
        const s = window.state;
        if (!s || s.status !== 'playing' || adv.paused) return;

        const canvas = document.getElementById('gameCanvas');
        const ctx    = canvas.getContext('2d');

        // Laser, explosions, sparkles
        window.GameEffects.updateLasers();
        window.GameEffects.updateExplosions();
        window.GameEffects.updateSparkles();

        // Slow-mo tick
        window.GameEffects.tickSlowMo();

        // Close-encounter checks
        checkProximity();

        // Laser cooldown tick
        if (adv.laserCooldown > 0) adv.laserCooldown--;

        // HUD numeric update
        updateHUD();
    }

    /* ================================================================
       INSTRUMENT BASE GAME'S ANIMATE WITH POST-RENDER HOOK
       We replace window.animate with a thin wrapper that:
         1. Calls the original (which does ctx.save/restore + all drawing)
         2. Then calls postRenderHook to draw effects on top
       The base game's top-level `requestAnimationFrame(animate)` call
       uses the local `animate` variable, not window.animate, so we CANNOT
       intercept the scheduling. Instead we use a parallel rAF that runs
       postRenderHook every frame independently.
       ================================================================ */
    function startPostRenderLoop() {
        function loop() {
            requestAnimationFrame(loop);
            if (!adv.paused) postRenderHook();
        }
        requestAnimationFrame(loop);
    }

    /* ================================================================
       AUDIO SFX
       ================================================================ */
    function playLaserSfx() {
        try {
            const ac  = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ac.createOscillator();
            const g   = ac.createGain();
            osc.connect(g); g.connect(ac.destination);
            const t = ac.currentTime;
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(1400, t);
            osc.frequency.exponentialRampToValueAtTime(180, t + 0.14);
            g.gain.setValueAtTime(0.14, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
            osc.start(t); osc.stop(t + 0.14);
        } catch (_) {}
    }

    function playDiamondSfx() {
        try {
            const ac  = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ac.createOscillator();
            const g   = ac.createGain();
            osc.connect(g); g.connect(ac.destination);
            const t = ac.currentTime;
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880,  t);
            osc.frequency.setValueAtTime(1320, t + 0.06);
            osc.frequency.setValueAtTime(1760, t + 0.12);
            g.gain.setValueAtTime(0.12, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
            osc.start(t); osc.stop(t + 0.28);
        } catch (_) {}
    }

    /* ================================================================
       INPUT HANDLERS
       ================================================================ */
    function setupInput() {
        // Keyboard
        window.addEventListener('keydown', e => {
            if (e.code === 'KeyP' || e.code === 'Escape') {
                adv.paused ? resume() : pause();
            }
            if (e.code === 'KeyF') fireLaser();
        });

        // Click to fire (not on UI buttons)
        window.addEventListener('click', e => {
            if (e.target.closest && e.target.closest('button, #pauseOverlay')) return;
            if (window.state && window.state.status === 'playing' && !adv.paused) fireLaser();
        });

        // Pause button
        document.getElementById('pauseBtn').addEventListener('click', e => {
            e.stopPropagation();
            adv.paused ? resume() : pause();
        });

        // Resume button
        document.getElementById('resumeBtn').addEventListener('click', e => {
            e.stopPropagation();
            resume();
        });

        // Touch fire support (two-finger or second touch)
        let touchCount = 0;
        window.addEventListener('touchstart', e => {
            touchCount = e.touches.length;
            if (touchCount >= 2 && window.state && window.state.status === 'playing') {
                fireLaser();
            }
        }, { passive: true });
    }

    /* ================================================================
       HOOK startBtn to show HUD & reset counters
       ================================================================ */
    function hookStartButton() {
        const btn = document.getElementById('startBtn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            adv.diamonds = 0;
            adv.coins    = 0;
            adv.paused   = false;
            window.advPaused = false;
            // Small delay to let initGame() run first
            setTimeout(() => {
                updateHUD();
                showAdvHUD();
            }, 60);
        }, true /* capture — runs before other listeners */);
    }

    /* ================================================================
       MAIN
       ================================================================ */
    function main() {
        console.log('[AdvFeatures] 🚀 Initialising advanced module…');

        buildDOM();

        // Init effects engine with canvas
        const canvas = document.getElementById('gameCanvas');
        const ctx    = canvas.getContext('2d');
        window.GameEffects.init(canvas, ctx);

        // Override Player draw with enhanced robot
        overridePlayerDraw();

        // Start post-render effect loop
        startPostRenderLoop();

        // Expose coin award hook for IEEE tokens collected in base game
        window._advAwardCoin = function(wx, wy) {
            adv.coins++;
            updateHUD();
            bumpCounter('coinCount');
            if (window._showIEEECoinText) window._showIEEECoinText(wx, wy);
        };

        // Input
        setupInput();
        hookStartButton();

        console.log('[AdvFeatures] ✅ Ready  |  P = Pause  |  F / Click = Fire Laser');
    }

    /* ================================================================
       BOOT
       ================================================================ */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => waitForGame(main));
    } else {
        waitForGame(main);
    }

})();
