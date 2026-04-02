/**
 * QUANTUM DREAMSCAPE - VISUAL EFFECTS ENGINE
 * game-effects.js
 *
 * Handles: laser beam, explosions, sparkles, slow-mo, cinematic zoom,
 *          zero-gravity floating canvas animations, screen shake CSS layer.
 */

/* ============================================================
   EFFECTS MANAGER — wraps canvas rendering, laser, explosions
   ============================================================ */
window.GameEffects = (function () {

    // Reference to game canvas and ctx (set after DOM ready)
    let _canvas, _ctx;

    // Laser state
    const lasers = [];        // active laser beams
    const explosions = [];    // active explosion particle systems
    const fireParticles = []; // fire/ember on burning asteroids

    // Cinematic / slow-mo
    let slowMoTimer     = 0;
    let zoomTarget      = 1.0;
    let zoomCurrent     = 1.0;
    const ZOOM_SPEED    = 0.04;
    const SLOWMO_SCALE  = 0.25; // time scale during slow-mo

    // Sparkle pool
    const sparkles = [];

    // ----------------------------------------------------------------
    //  INIT
    // ----------------------------------------------------------------
    function init(canvas, ctx) {
        _canvas = canvas;
        _ctx    = ctx;
    }

    // ----------------------------------------------------------------
    //  LASER
    // ----------------------------------------------------------------
    function fireLaser(fromX, fromY, toX, toY) {
        lasers.push({
            x1: fromX, y1: fromY,
            x2: toX,   y2: toY,
            life: 1.0,
            width: 4,
            color: '#00ffff'
        });

        // Screen flash
        const flash = document.getElementById('laserFlash');
        if (flash) {
            flash.classList.add('flash-active');
            setTimeout(() => flash.classList.remove('flash-active'), 150);
        }

        // Play laser SFX via base-game audio if available
        if (window.playSfx) {
            try { window.playSfx('laser'); } catch(e) { /* ignore */ }
        }
    }

    function updateLasers() {
        for (let i = lasers.length - 1; i >= 0; i--) {
            const l = lasers[i];
            l.life -= 0.07;
            if (l.life <= 0) { lasers.splice(i, 1); continue; }

            // Draw neon glow beam
            _ctx.save();
            _ctx.globalAlpha = l.life;
            _ctx.lineCap = 'round';

            // Outer soft glow
            _ctx.lineWidth = l.width * 6;
            _ctx.strokeStyle = 'rgba(0,100,255,0.25)'; // Deep blue glow
            _ctx.shadowBlur = 0;
            _ctx.beginPath();
            _ctx.moveTo(l.x1, l.y1);
            _ctx.lineTo(l.x2, l.y2);
            _ctx.stroke();

            // Mid glow
            _ctx.lineWidth = l.width * 2.5;
            _ctx.strokeStyle = 'rgba(0,120,255,0.5)'; // Mid blue
            _ctx.beginPath();
            _ctx.moveTo(l.x1, l.y1);
            _ctx.lineTo(l.x2, l.y2);
            _ctx.stroke();

            // Core bright beam
            _ctx.lineWidth = l.width * 0.8;
            _ctx.strokeStyle = '#ffffff';
            _ctx.shadowColor  = '#0055ff'; // Pure bright blue shadow
            _ctx.shadowBlur   = 20;
            _ctx.beginPath();
            _ctx.moveTo(l.x1, l.y1);
            _ctx.lineTo(l.x2, l.y2);
            _ctx.stroke();

            _ctx.restore();
        }
    }

    // ----------------------------------------------------------------
    //  EXPLOSION
    // ----------------------------------------------------------------
    function createExplosion(x, y, radius) {
        const count = 40 + Math.floor(radius * 1.5);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 7 + 1;
            const colors = ['#ff6600','#ff3300','#ffaa00','#ff00aa','#fff','#66eeff','#ffff00'];
            explosions.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: Math.random() * 6 + 2,
                color: colors[Math.floor(Math.random() * colors.length)],
                alpha: 1.0,
                decay: 0.02 + Math.random() * 0.03,
                spin: (Math.random() - 0.5) * 0.3,
                angle: Math.random() * Math.PI * 2
            });
        }

        // Also add lingering fire particles
        for (let i = 0; i < 20; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 3 + 0.5;
            fireParticles.push({
                x: x + (Math.random() - 0.5) * radius,
                y: y + (Math.random() - 0.5) * radius,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.5, // slight upward drift
                size: Math.random() * 10 + 5,
                alpha: 0.9,
                decay: 0.015 + Math.random() * 0.02
            });
        }
    }

    function updateExplosions() {
        for (let i = explosions.length - 1; i >= 0; i--) {
            const p = explosions[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.12; // gravity pull on fragments
            p.vx *= 0.97;
            p.alpha -= p.decay;
            p.size  *= 0.97;
            p.angle += p.spin;
            if (p.alpha <= 0) { explosions.splice(i, 1); continue; }

            _ctx.save();
            _ctx.globalAlpha = Math.max(0, p.alpha);
            _ctx.translate(p.x, p.y);
            _ctx.rotate(p.angle);
            _ctx.shadowColor = p.color;
            _ctx.shadowBlur  = 8;
            _ctx.fillStyle   = p.color;
            _ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            _ctx.restore();
        }

        // Fire particles
        for (let i = fireParticles.length - 1; i >= 0; i--) {
            const f = fireParticles[i];
            f.x += f.vx;
            f.y += f.vy;
            f.vy -= 0.05; // buoyancy (fire rises)
            f.alpha -= f.decay;
            f.size  *= 0.96;
            if (f.alpha <= 0) { fireParticles.splice(i, 1); continue; }

            const progress = 1 - f.alpha;
            // hot → cool color shift: white → yellow → orange → red → dark red
            const r = 255;
            const g = Math.floor(200 * (1 - progress * 0.8));
            const b = Math.floor(50  * (1 - progress));
            _ctx.save();
            _ctx.globalAlpha = Math.max(0, f.alpha);
            _ctx.shadowColor = `rgb(${r},${g},${b})`;
            _ctx.shadowBlur  = 15;
            _ctx.fillStyle   = `rgb(${r},${g},${b})`;
            _ctx.beginPath();
            _ctx.arc(f.x, f.y, Math.max(0.1, f.size), 0, Math.PI * 2);
            _ctx.fill();
            _ctx.restore();
        }
    }

    // ----------------------------------------------------------------
    //  SPARKLES (diamond collect)
    // ----------------------------------------------------------------
    function createSparkle(screenX, screenY) {
        for (let i = 0; i < 14; i++) {
            const angle = (i / 14) * Math.PI * 2;
            const speed = Math.random() * 4 + 2;
            sparkles.push({
                x: screenX,
                y: screenY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1,
                size: Math.random() * 5 + 2,
                alpha: 1.0,
                decay: 0.03 + Math.random() * 0.02
            });
        }

        // DOM sparkle text
        showCollectText(screenX, screenY);
    }

    function showCollectText(x, y) {
        const el = document.createElement('div');
        el.className = 'collect-text';
        el.innerHTML = '+1 💎';
        el.style.left = `${x - 30}px`;
        el.style.top  = `${y - 20}px`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1300);
    }

    function showIEEECoinText(x, y) {
        const el = document.createElement('div');
        el.className = 'collect-text';
        el.style.color = '#ffd700';
        el.style.textShadow = '0 0 10px #ffd700';
        el.innerHTML = '+1 <span style="font-size:.8em;border:1px solid #ffd700;border-radius:3px;padding:1px 4px;">IEEE</span>';
        el.style.left = `${x - 40}px`;
        el.style.top  = `${y - 20}px`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1300);
    }
    window._showIEEECoinText = showIEEECoinText;

    function updateSparkles() {
        for (let i = sparkles.length - 1; i >= 0; i--) {
            const s = sparkles[i];
            s.x += s.vx;
            s.y += s.vy;
            s.vy += 0.05;
            s.alpha -= s.decay;
            s.size  *= 0.95;
            if (s.alpha <= 0) { sparkles.splice(i, 1); continue; }

            _ctx.save();
            _ctx.globalAlpha = Math.max(0, s.alpha);
            _ctx.shadowColor = '#66eeff';
            _ctx.shadowBlur  = 10;
            _ctx.fillStyle   = '#66eeff';
            // Draw a small star/diamond shape
            drawStar(_ctx, s.x, s.y, 4, s.size, s.size * 0.4);
            _ctx.restore();
        }
    }

    function drawStar(ctx, cx, cy, spikes, outerR, innerR) {
        let rot = (Math.PI / 2) * 3;
        const step = Math.PI / spikes;
        ctx.beginPath();
        ctx.moveTo(cx, cy - outerR);
        for (let i = 0; i < spikes; i++) {
            ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
            rot += step;
            ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
            rot += step;
        }
        ctx.lineTo(cx, cy - outerR);
        ctx.closePath();
        ctx.fill();
    }

    // ----------------------------------------------------------------
    //  SLOW-MO & ZOOM
    // ----------------------------------------------------------------
    function activateSlowMo(duration) {
        slowMoTimer = duration;
        zoomTarget  = 1.6;
        const indicator = document.getElementById('slowMoIndicator');
        if (indicator) indicator.classList.add('active');
    }

    function tickSlowMo() {
        if (slowMoTimer > 0) {
            slowMoTimer--;
            if (slowMoTimer <= 0) {
                zoomTarget = 1.0;
                const indicator = document.getElementById('slowMoIndicator');
                if (indicator) indicator.classList.remove('active');
            }
        }

        // Lerp zoom
        const diff = zoomTarget - zoomCurrent;
        if (Math.abs(diff) > 0.001) {
            zoomCurrent += diff * ZOOM_SPEED;
        }
    }

    function getTimeScale() {
        return slowMoTimer > 0 ? SLOWMO_SCALE : 1.0;
    }

    function getZoom() { return zoomCurrent; }
    function isSlowMo() { return slowMoTimer > 0; }

    // ----------------------------------------------------------------
    //  TARGETING RETICLE
    // ----------------------------------------------------------------
    function showTargetReticle(x, y) {
        const r = document.getElementById('targetingReticle');
        if (!r) return;
        r.style.display = 'block';
        r.style.left = `${x}px`;
        r.style.top  = `${y}px`;
    }

    function hideTargetReticle() {
        const r = document.getElementById('targetingReticle');
        if (r) r.style.display = 'none';
    }

    // ----------------------------------------------------------------
    //  ZERO-G CANVAS OVERLAY (floating dust/orbs during pause)
    // ----------------------------------------------------------------
    const zeroGOrbs = [];

    function spawnZeroGOrbs() {
        zeroGOrbs.length = 0;
        if (!_canvas) return;
        for (let i = 0; i < 50; i++) {
            zeroGOrbs.push({
                x: Math.random() * _canvas.width,
                y: Math.random() * _canvas.height,
                vx: (Math.random() - 0.5) * 1.2,
                vy: (Math.random() - 0.5) * 1.2 - 0.3,
                size: Math.random() * 6 + 2,
                color: Math.random() > 0.5 ? '#00f2fe' : '#ff00ff',
                alpha: Math.random() * 0.6 + 0.3,
                twinkle: Math.random() * Math.PI * 2
            });
        }
    }

    function clearZeroGOrbs() {
        zeroGOrbs.length = 0;
    }

    function drawZeroGOrbs(frame) {
        if (!_ctx || zeroGOrbs.length === 0) return;
        for (const orb of zeroGOrbs) {
            orb.x += orb.vx;
            orb.y += orb.vy;
            orb.twinkle += 0.05;

            // wrap around canvas
            if (orb.x < -10) orb.x = _canvas.width + 10;
            if (orb.x > _canvas.width + 10) orb.x = -10;
            if (orb.y < -10) orb.y = _canvas.height + 10;
            if (orb.y > _canvas.height + 10) orb.y = -10;

            const a = orb.alpha * (0.7 + 0.3 * Math.sin(orb.twinkle));
            _ctx.save();
            _ctx.globalAlpha = a;
            _ctx.shadowColor = orb.color;
            _ctx.shadowBlur  = 12;
            _ctx.fillStyle   = orb.color;
            _ctx.beginPath();
            _ctx.arc(orb.x, orb.y, orb.size, 0, Math.PI * 2);
            _ctx.fill();
            _ctx.restore();
        }
    }

    // ----------------------------------------------------------------
    //  ROBOT DRAWING — delegates to shared drawCanvasRobot in index.html
    // ----------------------------------------------------------------
    function drawRobot(ctx, x, y, frame, isGrounded, isZeroG) {
        if (window.drawCanvasRobot) {
            window.drawCanvasRobot(ctx, x, y, frame, isGrounded, isZeroG);
            return;
        }
        // Fallback mini robot
        ctx.save();
        ctx.translate(x,y);
        ctx.fillStyle='#fff'; ctx.shadowColor='#00f2fe'; ctx.shadowBlur=10;
        ctx.beginPath(); ctx.roundRect(2,10,40,30,8); ctx.fill();
        ctx.fillStyle='#111'; ctx.beginPath(); ctx.roundRect(7,14,30,14,6); ctx.fill();
        ctx.fillStyle='#00f2fe';
        ctx.beginPath(); ctx.ellipse(16,20,4,5,0,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(32,20,4,5,0,0,Math.PI*2); ctx.fill();
        ctx.restore();
    }
    function _drawRobotFull(ctx, x, y, frame, isGrounded, isZeroG) {
        ctx.save();
        ctx.translate(x, y);

        // Floating bob animation
        const bobOffset = isZeroG
            ? Math.sin(frame * 0.04) * 10
            : (isGrounded ? Math.abs(Math.sin(frame * 0.3)) * 3 : 0);

        // Lean forward slightly (running feel)
        ctx.rotate(-0.08);
        ctx.translate(0, -bobOffset);

        const W = 36, H = 52; // robot dimensions

        // --- Jet / thruster particles (emit from feet) ---
        if (isGrounded || isZeroG) {
            for (let i = 0; i < 2; i++) {
                const thrustW = 8;
                const thrustH = Math.random() * 14 + 6;
                const tx = (i === 0) ? 2 : W - 12;
                ctx.globalAlpha = 0.4 + Math.random() * 0.3;
                const grad = ctx.createLinearGradient(tx, H, tx, H + thrustH);
                grad.addColorStop(0, '#ff00ff');
                grad.addColorStop(1, 'rgba(255,0,255,0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.ellipse(tx + thrustW / 2, H + thrustH / 2, thrustW / 2, thrustH / 2, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;

        // --- Legs (animated running) ---
        const legSwing = Math.sin(frame * 0.4) * 12;
        const legColors = ['#1a1a2e', '#16213e'];
        // Leg 1
        ctx.fillStyle = legColors[0];
        ctx.shadowColor = '#00f2fe'; ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.roundRect(4, H - 14, 10, 18 + legSwing * 0.5, 4);
        ctx.fill();
        // Leg 2
        ctx.beginPath();
        ctx.roundRect(W - 14, H - 14, 10, 18 - legSwing * 0.5, 4);
        ctx.fill();

        // Feet
        ctx.fillStyle = '#00f2fe';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.ellipse(9, H + 4 + legSwing * 0.3, 8, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(W - 9, H + 4 - legSwing * 0.3, 8, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // --- Body ---
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur  = 12;
        const bodyGrad = ctx.createLinearGradient(0, H * 0.35, W, H * 0.8);
        bodyGrad.addColorStop(0, '#e8eaf6');
        bodyGrad.addColorStop(0.5, '#ffffff');
        bodyGrad.addColorStop(1, '#dde2ff');
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.roundRect(2, H * 0.38, W - 4, H * 0.44, 8);
        ctx.fill();

        // Energy core (glowing chest orb)
        const coreX = W / 2, coreY = H * 0.55;
        const corePulse = 0.85 + 0.15 * Math.sin(frame * 0.12);
        const coreGrad = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, 9);
        coreGrad.addColorStop(0, '#ffffff');
        coreGrad.addColorStop(0.3, '#00f2fe');
        coreGrad.addColorStop(1, 'rgba(0,100,200,0)');
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur  = 20 * corePulse;
        ctx.fillStyle   = coreGrad;
        ctx.beginPath();
        ctx.arc(coreX, coreY, 7 * corePulse, 0, Math.PI * 2);
        ctx.fill();

        // Armor lines on body
        ctx.strokeStyle = 'rgba(0,200,255,0.25)';
        ctx.lineWidth   = 1;
        ctx.shadowBlur  = 0;
        for (let il = 0; il < 3; il++) {
            ctx.beginPath();
            ctx.moveTo(5, H * 0.42 + il * 7);
            ctx.lineTo(W - 5, H * 0.42 + il * 7);
            ctx.stroke();
        }

        // --- Left arm (with laser cannon) ---
        const armSwing = Math.sin(frame * 0.4 + Math.PI) * 10;
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur  = 6;
        ctx.fillStyle   = '#1a1a2e';
        // Upper arm
        ctx.save();
        ctx.translate(-2, H * 0.42);
        ctx.rotate(0.3 + armSwing * 0.03);
        ctx.beginPath();
        ctx.roundRect(-6, 0, 8, 16, 4);
        ctx.fill();
        // Forearm + cannon
        ctx.translate(-2, 16);
        ctx.fillStyle = '#2a2a4e';
        ctx.beginPath();
        ctx.roundRect(-6, 0, 10, 14, 3);
        ctx.fill();
        // Cannon barrel
        ctx.fillStyle = '#00f2fe';
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur  = 15;
        ctx.beginPath();
        ctx.roundRect(-9, 10, 16, 5, 3);
        ctx.fill();
        // Cannon muzzle glow
        ctx.beginPath();
        ctx.arc(-9, 12, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,242,254,0.5)';
        ctx.fill();
        ctx.restore();

        // --- Right arm ---
        ctx.fillStyle = '#1a1a2e';
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur  = 6;
        ctx.save();
        ctx.translate(W + 2, H * 0.42);
        ctx.rotate(-0.3 - armSwing * 0.03);
        ctx.beginPath();
        ctx.roundRect(-2, 0, 8, 16, 4);
        ctx.fill();
        ctx.translate(2, 16);
        ctx.fillStyle = '#2a2a4e';
        ctx.beginPath();
        ctx.roundRect(-4, 0, 10, 14, 3);
        ctx.fill();
        ctx.restore();

        // --- Head ---
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur  = 15;
        const headGrad = ctx.createLinearGradient(2, 0, W - 2, H * 0.3);
        headGrad.addColorStop(0, '#f0f4ff');
        headGrad.addColorStop(1, '#ffffff');
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.roundRect(4, H * 0.05, W - 8, H * 0.33, 10);
        ctx.fill();

        // Visor / face screen
        ctx.fillStyle = '#0a0a1a';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.roundRect(7, H * 0.1, W - 14, H * 0.18, 6);
        ctx.fill();

        // Eyes
        const eyeGlow = 0.8 + 0.2 * Math.sin(frame * 0.08);
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur  = 12 * eyeGlow;
        ctx.fillStyle   = `rgba(0,242,254,${eyeGlow})`;
        // Left eye
        ctx.beginPath();
        ctx.ellipse(12, H * 0.18, 3, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        // Right eye
        ctx.beginPath();
        ctx.ellipse(W - 12, H * 0.18, 3, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Antenna
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth   = 2;
        ctx.shadowBlur  = 8;
        ctx.beginPath();
        ctx.moveTo(W / 2, H * 0.05);
        ctx.lineTo(W / 2, -8);
        ctx.stroke();
        ctx.fillStyle = '#00f2fe';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(W / 2, -10, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Helmet ridge / top panel
        ctx.fillStyle = 'rgba(0,200,255,0.2)';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.roundRect(6, H * 0.05 - 2, W - 12, 6, 3);
        ctx.fill();

        ctx.restore();
    }
    // end _drawRobotFull (kept for reference)

    // ----------------------------------------------------------------
    //  BURNING ASTEROID DRAW
    // ----------------------------------------------------------------
    function drawBurningAsteroid(ctx, x, y, radius, frame, burnProgress) {
        ctx.save();
        ctx.translate(x, y);

        // Spinning and breaking
        ctx.rotate(frame * 0.05 * (burnProgress + 0.5));

        // Base rock
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const r = radius * (0.85 + Math.random() * 0.15 * burnProgress);
            if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
            else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
        }
        ctx.closePath();
        ctx.fillStyle = `rgb(${Math.floor(80 + burnProgress * 100)}, ${Math.floor(40 - burnProgress * 30)}, 0)`;
        ctx.shadowColor = '#ff4400';
        ctx.shadowBlur  = 15 + burnProgress * 20;
        ctx.fill();

        // Fire glow overlay
        const fireGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        fireGrad.addColorStop(0, `rgba(255,200,0,${0.6 * burnProgress})`);
        fireGrad.addColorStop(0.5, `rgba(255,80,0,${0.4 * burnProgress})`);
        fireGrad.addColorStop(1, `rgba(255,0,0,0)`);
        ctx.fillStyle = fireGrad;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // ----------------------------------------------------------------
    //  PUBLIC API
    // ----------------------------------------------------------------
    return {
        init,
        fireLaser,
        updateLasers,
        createExplosion,
        updateExplosions,
        createSparkle,
        updateSparkles,
        activateSlowMo,
        tickSlowMo,
        getTimeScale,
        getZoom,
        isSlowMo,
        showTargetReticle,
        hideTargetReticle,
        spawnZeroGOrbs,
        clearZeroGOrbs,
        drawZeroGOrbs,
        drawRobot,
        drawBurningAsteroid
    };

})();
