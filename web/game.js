/*
 * The Snailon Invasion - web port
 * Faithful port of the Python/pygame game (settings.py, game_functions.py,
 * ship.py, alien.py, bullet.py, scoreboard.py, button.py, game_stats.py),
 * extended with a giant-snail boss, enemy slime fire, sound, particles, and
 * power-ups.
 *
 * Single classic script (no ES modules) so it runs by opening index.html
 * directly from the filesystem. All gameplay math uses the original's native
 * 1500x800 coordinate space; the canvas is CSS-scaled to fit the viewport.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Settings  (port of settings.py)
  // ---------------------------------------------------------------------------
  const Settings = {
    // Screen
    screenWidth: 1500,
    screenHeight: 800,
    bgColor: "rgb(230, 230, 230)",

    // Ship
    shipLimit: 3, // lives

    // Bullets
    bulletWidth: 3,
    bulletHeight: 15,
    bulletColor: "rgb(60, 60, 60)",
    bulletsAllowed: 6,

    // Aliens
    fleetDropSpeed: 10, // pixels the fleet drops when it reaches an edge

    // How quickly the game speeds up
    speedupScale: 1.25,
    scoreScale: 1.25,

    // Dynamic settings (re-initialized each new game)
    shipSpeedFactor: 1.5,
    bulletSpeedFactor: 3,
    alienSpeedFactor: 1,
    fleetDirection: 1, // 1 = right, -1 = left
    alienPoints: 50,

    initializeDynamicSettings() {
      this.shipSpeedFactor = 1.5;
      this.bulletSpeedFactor = 3;
      this.alienSpeedFactor = 1;
      this.fleetDirection = 1;
      this.alienPoints = 50;
    },

    increaseSpeed() {
      // Per the original, the per-level speedup affects bullets and aliens
      // (and point value). The ship's own speed is player-controlled.
      this.bulletSpeedFactor *= this.speedupScale;
      this.alienSpeedFactor *= this.speedupScale;
      this.alienPoints = Math.floor(this.alienPoints * this.scoreScale);
    },
  };

  // ---------------------------------------------------------------------------
  // Game statistics  (port of game_stats.py)
  // ---------------------------------------------------------------------------
  const HIGH_SCORE_KEY = "snailon.highScore";
  const Stats = {
    shipsLeft: Settings.shipLimit,
    level: 1,
    score: 0,
    highScore: loadHighScore(),
    gameActive: false,

    resetStats() {
      this.shipsLeft = Settings.shipLimit;
      this.level = 1;
      this.score = 0;
    },
  };

  function loadHighScore() {
    try {
      return parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0;
    } catch (e) {
      return 0; // localStorage may be unavailable under some file:// configs
    }
  }

  function saveHighScore(value) {
    try {
      localStorage.setItem(HIGH_SCORE_KEY, String(value));
    } catch (e) {
      /* ignore persistence failures */
    }
  }

  // ---------------------------------------------------------------------------
  // Canvas + images
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  // Hebrew UI strings (taunts, banners) need RTL paragraph direction so that
  // neutral characters (punctuation, emoji) attach to the correct side of the
  // text instead of trailing off in LTR reading order. All alignment in this
  // file uses the physical "left"/"right"/"center" keywords, so this has no
  // effect on the English/number strings.
  ctx.direction = "rtl";

  const SHIP_W = 80;
  const SHIP_H = 100;
  const ALIEN_W = 100;
  const ALIEN_H = 80;

  // Ship speed is a 1..N "level" the player tunes with Up/Down (shown on the HUD
  // speed meter). Higher default than the original so the ship feels snappy.
  const SHIP_MAX_SPEED_LEVEL = 10;
  const SHIP_DEFAULT_SPEED_LEVEL = 6;
  const SHIP_SPEED_PER_LEVEL = 0.6; // movement factor per level (scaled by dt)

  // Giant-snail boss
  const BOSS_W = ALIEN_W * 3.6; // 360
  const BOSS_H = ALIEN_H * 3.6; // 288
  const BOSS_EVERY = 3; // a boss replaces the fleet on every Nth level
  const BOSS_Y = 110;

  // Enemy slime fire
  const SLIME_W = 16;
  const SLIME_H = 22;
  const SLIME_SPEED = 1.8; // movement factor (scaled by dt)
  const SHRAPNEL_SPEED = 0.9; // exploding-snailon burst: slow, so it's easy to dodge
  const ENEMY_FIRE_BASE_MS = 1100;

  // Power-ups
  const POWERUP_SIZE = 36;
  const POWERUP_FALL = 1.6; // movement factor
  const POWERUP_DROP_CHANCE = 0.12;
  const POWER_DURATION_MS = 7000;
  const RAPID_CADENCE_MS = 110;

  // A snailon killed mid-taunt drops its speech bubble, which falls and stuns
  // the ship on contact.
  const BUBBLE_FALL = 1.4; // movement factor
  const STUN_DURATION_MS = 1400;

  // Small snailons (splitter children / matriarch hatchlings)
  const BABY_W = 60;
  const BABY_H = 48;

  // Mayo easter egg (type "מיונז" or "mayo" mid-game)
  const MAYO_DURATION_MS = 20000;
  const MAYO_DMG = 3;
  const MAYO_JAR_W = 44;
  const MAYO_JAR_H = 54;
  // Ambient "mayo rain": random gap (ms) between self-dropping mayo boost jars.
  const MAYO_RAIN_MIN_MS = 7000;
  const MAYO_RAIN_MAX_MS = 14000;

  // Snailon enemy types. Each shares the one snail sprite but gets a distinct
  // colored aura + a canvas-drawn emblem (see drawEmblem) so they LOOK different,
  // plus its own behavior flags. No extra image assets needed.
  const SNAILON_TYPES = {
    regular:   { aura: null,                     hp: 1, points: 1 },
    baby:      { aura: null,                     hp: 1, points: 1, small: true },
    exploding: { aura: "rgba(240,120,30,0.35)",  hp: 1, points: 1, explode: true },
    armored:   { aura: "rgba(90,100,120,0.45)",  hp: 2, points: 2 },
    splitter:  { aura: "rgba(150,70,200,0.35)",  hp: 1, points: 1, split: true },
    fast:      { aura: "rgba(40,180,200,0.30)",  hp: 1, points: 1 },
    evil:      { aura: "rgba(200,30,30,0.32)",   hp: 1, points: 2, evil: true },
    king:      { aura: "rgba(235,195,40,0.42)",  hp: 5, points: 6, king: true },
    woman:     { aura: "rgba(240,90,180,0.32)",  hp: 1, points: 2, woman: true },
  };

  const images = { ship: new Image(), alien: new Image() };
  images.ship.src = "images/salt_shaker.png";
  images.alien.src = "images/alien.png";

  // ---------------------------------------------------------------------------
  // Sound  (synthesized via WebAudio - no asset files)
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  function initAudio() {
    // Must be created/resumed from a user gesture (the Play click / Enter key).
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {
      audioCtx = null;
    }
  }

  function tone(freq, freqEnd, dur, type, vol) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd && freqEnd !== freq) {
      o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    }
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const n = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = audioCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = filterFreq || 1200;
    src.connect(lp);
    lp.connect(g);
    g.connect(audioCtx.destination);
    src.start(t);
  }

  function sfx(name) {
    if (!audioCtx) return;
    switch (name) {
      case "shoot": tone(680, 320, 0.08, "square", 0.04); break;
      case "hit": tone(220, 140, 0.06, "square", 0.05); break;
      case "explode": noise(0.25, 0.12, 900); break;
      case "bossHit": tone(140, 90, 0.07, "sawtooth", 0.05); break;
      case "bossDie": tone(300, 50, 0.7, "sawtooth", 0.12); noise(0.5, 0.1, 700); break;
      case "powerup": tone(520, 1040, 0.25, "triangle", 0.07); break;
      case "playerHit": noise(0.4, 0.16, 500); tone(200, 60, 0.3, "sawtooth", 0.08); break;
      case "shield": tone(880, 1320, 0.15, "triangle", 0.07); break;
      case "levelup": tone(523, 1046, 0.3, "triangle", 0.08); break;
      case "mayo": tone(520, 130, 0.35, "sine", 0.09); noise(0.3, 0.08, 500); break;
      case "mayoShot": tone(240, 110, 0.07, "sine", 0.05); break;
    }
  }

  // ---------------------------------------------------------------------------
  // Background music  (a single looping track: web/music.mp3)
  // ---------------------------------------------------------------------------
  let musicOn = true;
  const music = new Audio("music.mp3");
  music.loop = true;
  music.volume = 0.5;

  // The song starts as soon as the page loads and then plays continuously — it
  // loops and is NOT stopped on pause or game over (B mutes/unmutes it). Browser
  // autoplay policy usually blocks audio until the first user interaction, so
  // primeMusic() tries immediately AND arms one-shot listeners that start it on
  // the first key/pointer/touch — whichever lands first.
  function startMusic() {
    if (musicOn) music.play().catch(() => {});
  }

  function toggleMusic() {
    musicOn = !musicOn;
    if (musicOn) music.play().catch(() => {});
    else music.pause();
  }

  function primeMusic() {
    startMusic(); // immediate attempt on load (plays if the browser allows it)
    const kick = () => {
      startMusic();
      if (!music.paused) {
        window.removeEventListener("pointerdown", kick);
        window.removeEventListener("keydown", kick);
        window.removeEventListener("touchstart", kick);
      }
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    window.addEventListener("touchstart", kick);
  }

  // ---------------------------------------------------------------------------
  // Entities & dynamic state
  // ---------------------------------------------------------------------------
  let bullets = [];
  let aliens = [];
  let enemyShots = []; // falling slime globs
  let particles = []; // explosion sparks (visual only)
  let powerups = []; // falling pickups
  let fallingBubbles = []; // dropped speech bubbles (from snailons killed mid-taunt)
  let boss = null; // active giant snail (or null)

  let elapsedMs = 0; // wall-clock ms of the current frame (for timers)
  let enemyFireMs = ENEMY_FIRE_BASE_MS; // countdown to the next fleet slime shot
  let fireCooldownMs = 0; // rapid-fire cadence countdown
  const powerState = { rapidMs: 0, spreadMs: 0, shield: false, mayoMs: 0, stunMs: 0 };

  let fleetSpeedMult = 1; // per-level fleet march multiplier (Fast levels)
  let births = []; // snailons spawned mid-frame (splitter children, hatchlings)
  let levelBannerMs = 0; // ms remaining to show the level-intro banner
  let levelName = ""; // banner text for the current level

  // Mayo easter egg state
  let typedBuffer = ""; // rolling buffer of recently typed characters
  let mayoUsedThisLevel = false;
  let mayoRainMs = 0; // ms until the next ambient mayo boost jar drops

  // Juice: screen shake + full-screen flash
  let shakeMs = 0;
  let shakeAmp = 0;
  let flashMs = 0;
  let flashDur = 1;
  let flashColor = null;

  function triggerShake(amp, ms) {
    if (amp >= shakeAmp || shakeMs <= 0) {
      shakeAmp = amp;
      shakeMs = ms;
    }
  }

  function triggerFlash(color, ms) {
    flashColor = color;
    flashMs = ms;
    flashDur = ms;
  }

  // Speech-bubble taunts (one active at a time)
  const TAUNTS = [
    "בשביל מה מזוודה ?",
    "עכשיו רציני בשביל מה מיונז ?",
    "זה זארה!",
    "כל הכבוד אייל 👏 בזבזת חולצה טובה על יציאה מע",
    "מחר אני שם את הלוק הסגול",
    "מכרתי את המחשב שלי אז קניתי שולחן בחינםםם",
    "תכנס לאתר חיקויים שלי",
    "עמאי",
    "שמע אתה קמצןןןן",
    "מי בא לטיול קמצנים",
    "דוריי הפסיד ללי סין מידד",
    "בלאנסטון וג'ינס הא",
  ];
  let tauntBag = []; // shuffled queue - every line plays once before any repeat
  let taunts = []; // active speech bubbles: [{ target, text, ms }]
  let tauntTimerMs = 1500;

  // Ship  (port of ship.py)
  const ship = {
    width: SHIP_W,
    height: SHIP_H,
    centerx: Settings.screenWidth / 2,
    speedLevel: SHIP_DEFAULT_SPEED_LEVEL, // player-tunable, independent of per-level speedup
    movingRight: false,
    movingLeft: false,

    get speed() {
      return this.speedLevel * SHIP_SPEED_PER_LEVEL;
    },
    get x() {
      return this.centerx - this.width / 2;
    },
    get y() {
      return Settings.screenHeight - this.height; // bottom-aligned
    },

    update(dt) {
      if (powerState.stunMs > 0) return; // stunned: no movement, no steering
      if (this.movingRight) this.centerx += this.speed * dt;
      if (this.movingLeft) this.centerx -= this.speed * dt;
      // Keep the ship within the screen edges.
      const half = this.width / 2;
      if (this.centerx < half) this.centerx = half;
      if (this.centerx > Settings.screenWidth - half)
        this.centerx = Settings.screenWidth - half;
    },

    centerShip() {
      this.centerx = Settings.screenWidth / 2;
      this.movingRight = false;
      this.movingLeft = false;
    },

    rect() {
      return { x: this.x, y: this.y, w: this.width, h: this.height };
    },

    draw() {
      ctx.drawImage(images.ship, this.x, this.y, this.width, this.height);
    },
  };

  // ---------------------------------------------------------------------------
  // Bullets  (port of bullet.py, extended with spread/rapid fire)
  // ---------------------------------------------------------------------------
  function currentBulletCap() {
    return powerState.rapidMs > 0 || powerState.spreadMs > 0 || powerState.mayoMs > 0
      ? 12
      : Settings.bulletsAllowed;
  }

  function spawnBullet(vx, mayo) {
    bullets.push({
      x: ship.centerx - (mayo ? 9 : Settings.bulletWidth / 2),
      y: ship.y, // start at the ship's top
      width: mayo ? 18 : Settings.bulletWidth,
      height: mayo ? 24 : Settings.bulletHeight,
      speed: Settings.bulletSpeedFactor, // captured at fire time
      vx: vx || 0,
      mayo: !!mayo,
      dmg: mayo ? MAYO_DMG : 1,
    });
  }

  function fireWeapon() {
    if (powerState.stunMs > 0) return; // stunned: can't fire
    const cap = currentBulletCap();
    if (bullets.length >= cap) return;
    if (powerState.mayoMs > 0) {
      // MAYO CANNON: 3-way spread of big high-damage mayo globs.
      spawnBullet(0, true);
      if (bullets.length < cap) spawnBullet(-2.2, true);
      if (bullets.length < cap) spawnBullet(2.2, true);
      sfx("mayoShot");
      return;
    }
    if (powerState.spreadMs > 0) {
      spawnBullet(0);
      if (bullets.length < cap) spawnBullet(-2.2);
      if (bullets.length < cap) spawnBullet(2.2);
    } else {
      spawnBullet(0);
    }
    sfx("shoot");
  }

  function updateRapidFire() {
    if (fireCooldownMs > 0) fireCooldownMs -= elapsedMs;
    const spaceHeld = held[" "] || held["Spacebar"];
    if (powerState.rapidMs > 0 && spaceHeld && fireCooldownMs <= 0) {
      fireWeapon();
      fireCooldownMs = RAPID_CADENCE_MS;
    }
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      b.y -= b.speed * dt;
      b.x += b.vx * dt;
    }
    bullets = bullets.filter(
      (b) => b.y + b.height > 0 && b.x > -30 && b.x < Settings.screenWidth + 30
    );

    checkBulletAlienCollisions();
    checkBulletBossCollisions();

    // A wave is cleared when no fleet remains and no boss is alive.
    if (aliens.length === 0 && !boss) startNextWave();
  }

  // ---------------------------------------------------------------------------
  // Aliens  (port of alien.py + fleet logic in game_functions.py)
  // ---------------------------------------------------------------------------
  function makeAlien(x, y, type) {
    const cfg = SNAILON_TYPES[type] || SNAILON_TYPES.regular;
    const w = cfg.small ? BABY_W : ALIEN_W;
    const h = cfg.small ? BABY_H : ALIEN_H;
    const a = { x: x, y: y, width: w, height: h, type: type || "regular", hp: cfg.hp, maxHp: cfg.hp };
    if (cfg.evil) a.fireMs = 1200 + Math.random() * 1500;
    if (cfg.woman) a.eggMs = 3500 + Math.random() * 1500;
    return a;
  }

  // Per-level theme. Boss on every BOSS_EVERY level; otherwise a fleet of one
  // type (or a weighted "mixed" fleet at higher levels).
  function levelPlan(level) {
    if (level % BOSS_EVERY === 0) return { boss: true };
    switch (level) {
      case 1: return { type: "regular", name: "REGULAR SNAILONS" };
      case 2: return { type: "exploding", density: 0.4, name: "EXPLODING SNAILONS" };
      case 4: return { type: "fast", name: "FAST SWARM" };
      case 5: return { type: "armored", name: "ARMORED SNAILONS" };
      case 7: return { type: "splitter", name: "SPLITTER SNAILONS" };
      case 8: return { type: "evil", name: "EVIL SNAILONS" };
      case 10: return { type: "woman", name: "SNAILON MATRIARCHS" };
      default: return { type: "mixed", name: "MIXED INVASION" };
    }
  }

  function pickMixedType() {
    const r = Math.random();
    if (r < 0.05) return "king";
    if (r < 0.2) return "woman";
    if (r < 0.4) return "exploding";
    if (r < 0.58) return "armored";
    if (r < 0.74) return "splitter";
    if (r < 0.9) return "evil";
    return "regular";
  }

  function setBanner(name) {
    levelName = name;
    levelBannerMs = 1800;
  }

  function getNumberAliensX() {
    const availableSpaceX = Settings.screenWidth - 2 * ALIEN_W;
    return Math.floor(availableSpaceX / (2 * ALIEN_W));
  }

  function getNumberRows() {
    const availableSpaceY = Settings.screenHeight - 2 * ALIEN_H - SHIP_H;
    return Math.floor(availableSpaceY / (2 * ALIEN_H));
  }

  function createFleet() {
    aliens = [];
    boss = null;
    births = [];
    Settings.fleetDirection = 1;
    enemyFireMs = ENEMY_FIRE_BASE_MS;
    const plan = levelPlan(Stats.level);
    fleetSpeedMult = plan.type === "fast" ? 1.7 : 1;
    setBanner("LEVEL " + Stats.level + " — " + plan.name);
    const cols = getNumberAliensX();
    const rows = getNumberRows();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = ALIEN_W + 2 * ALIEN_W * col;
        const y = ALIEN_H + 2 * ALIEN_H * row;
        let type;
        if (plan.type === "mixed") type = pickMixedType();
        else if (plan.density && Math.random() > plan.density) type = "regular";
        else type = plan.type;
        aliens.push(makeAlien(x, y, type));
      }
    }
  }

  function alienAtEdge(a) {
    return a.x + a.width >= Settings.screenWidth || a.x <= 0;
  }

  function changeFleetDirection() {
    for (const a of aliens) a.y += Settings.fleetDropSpeed;
    Settings.fleetDirection *= -1;
  }

  function updateAliens(dt) {
    if (!aliens.length) return;
    if (aliens.some(alienAtEdge)) changeFleetDirection();
    // Snailons always march at level-1 speed: the per-level speedup and the
    // fast-swarm boost do NOT affect fleet movement. Only the boss moves faster.
    const dx = Settings.fleetDirection * dt;
    for (const a of aliens) a.x += dx;

    // Ship-alien collision.
    if (aliens.some((a) => rectsOverlap(a, ship.rect()))) {
      shipHit();
      return;
    }
    // Alien reaching the bottom counts as a ship hit.
    if (aliens.some((a) => a.y + a.height >= Settings.screenHeight)) {
      shipHit();
    }
  }

  function checkBulletAlienCollisions() {
    if (!bullets.length || !aliens.length) return;
    const keptBullets = [];
    const deadAliens = new Set();
    for (const bullet of bullets) {
      let consumed = false;
      const b = { x: bullet.x, y: bullet.y, w: bullet.width, h: bullet.height };
      for (let ai = 0; ai < aliens.length; ai++) {
        if (deadAliens.has(ai)) continue;
        const a = aliens[ai];
        if (rectsOverlap(b, a)) {
          consumed = true;
          a.hp -= bullet.dmg || 1;
          spawnExplosion(
            bullet.x + bullet.width / 2, bullet.y,
            bullet.mayo ? "rgb(255, 255, 250)" : "rgb(255, 230, 120)",
            bullet.mayo ? 10 : 4,
            bullet.mayo ? 6 : 3
          );
          if (a.hp <= 0) {
            deadAliens.add(ai);
            const cfg = SNAILON_TYPES[a.type] || SNAILON_TYPES.regular;
            Stats.score += Settings.alienPoints * (cfg.points || 1);
            checkHighScore();
            onSnailonDeath(a, cfg);
          } else {
            sfx("bossHit"); // armored "clink" - survives this hit
          }
          break; // each bullet hits at most one snailon
        }
      }
      if (!consumed) keptBullets.push(bullet);
    }
    bullets = keptBullets;
    if (deadAliens.size) aliens = aliens.filter((_, i) => !deadAliens.has(i));
    if (births.length) {
      aliens.push(...births);
      births = [];
    }
  }

  function onSnailonDeath(a, cfg) {
    const cx = a.x + a.width / 2;
    const cy = a.y + a.height / 2;
    spawnExplosion(
      cx, cy,
      cfg.explode ? "rgb(240, 120, 30)" : "rgb(120, 90, 60)",
      cfg.explode ? 26 : 14,
      cfg.explode ? 7 : 5
    );
    triggerShake(cfg.explode ? 6 : 3, cfg.explode ? 220 : 140);
    if (cfg.explode) {
      sfx("explode");
      // Gentle burst: 2 slow globs angled outward (no straight-down) - easy to dodge.
      for (const vx of [-1.8, 1.8]) spawnSlime(cx - SLIME_W / 2, cy, vx, SHRAPNEL_SPEED);
    } else if (cfg.king) {
      sfx("bossDie");
    } else {
      sfx("hit");
    }
    if (cfg.split) {
      births.push(makeAlien(cx - BABY_W - 4, cy - BABY_H / 2, "baby"));
      births.push(makeAlien(cx + 4, cy - BABY_H / 2, "baby"));
    }
    if (cfg.king) dropPowerup(cx, cy); // guaranteed drop from the elite
    else maybeDropPowerup(cx, cy);
  }

  // Per-frame behavior for special snailons: evil aimed fire, matriarch eggs.
  function updateSpecialSnailons(dt) {
    if (boss || !aliens.length) return;
    for (const a of aliens) {
      const cfg = SNAILON_TYPES[a.type];
      if (!cfg) continue;
      if (cfg.evil) {
        a.fireMs -= elapsedMs;
        if (a.fireMs <= 0) {
          const cx = a.x + a.width / 2;
          const dxToShip = ship.centerx - cx;
          const vx = Math.max(-2.5, Math.min(2.5, dxToShip / 220));
          spawnSlime(cx - SLIME_W / 2, a.y + a.height, vx, SLIME_SPEED);
          a.fireMs = 3000 + Math.random() * 2000;
        }
      }
      if (cfg.woman) {
        a.eggMs -= elapsedMs;
        if (a.eggMs <= 0 && aliens.length + births.length < 60) {
          births.push(makeAlien(a.x + a.width / 2 - BABY_W / 2, a.y + a.height + 4, "baby"));
          spawnExplosion(a.x + a.width / 2, a.y + a.height, "rgb(240, 90, 180)", 8, 4);
          a.eggMs = 4000 + Math.random() * 2500;
        }
      }
    }
    if (births.length) {
      aliens.push(...births);
      births = [];
    }
  }

  function checkHighScore() {
    if (Stats.score > Stats.highScore) {
      Stats.highScore = Stats.score;
      saveHighScore(Stats.highScore);
    }
  }

  // ---------------------------------------------------------------------------
  // Giant-snail boss
  // ---------------------------------------------------------------------------
  function createBoss() {
    const tier = Math.floor(Stats.level / BOSS_EVERY); // 1, 2, 3, ...
    const maxHp = 45 + 25 * (tier - 1);
    aliens = [];
    births = [];
    enemyShots = [];
    fleetSpeedMult = 1;
    setBanner("LEVEL " + Stats.level + " — GIANT SNAILON");
    boss = {
      x: Settings.screenWidth / 2 - BOSS_W / 2,
      y: BOSS_Y,
      width: BOSS_W,
      height: BOSS_H,
      hp: maxHp,
      maxHp: maxHp,
      dir: 1,
      speed: 1.6, // movement factor (scaled by dt)
      fireMs: 1300,
      fireCdMs: 900, // delay before the first volley
      tier: tier,
    };
  }

  function updateBoss(dt) {
    if (!boss) return;
    const enraged = boss.hp <= boss.maxHp / 3;
    const spd = boss.speed * (enraged ? 1.7 : 1);
    boss.x += spd * boss.dir * dt;
    if (boss.x <= 0) {
      boss.x = 0;
      boss.dir = 1;
    }
    if (boss.x + boss.width >= Settings.screenWidth) {
      boss.x = Settings.screenWidth - boss.width;
      boss.dir = -1;
    }

    // Spit slime volleys downward.
    boss.fireCdMs -= elapsedMs;
    if (boss.fireCdMs <= 0) {
      const cx = boss.x + boss.width / 2;
      const by = boss.y + boss.height - 30;
      const spread = enraged ? [-3, -1.5, 0, 1.5, 3] : [-2, 0, 2];
      for (const vx of spread) spawnSlime(cx - SLIME_W / 2, by, vx);
      boss.fireCdMs = enraged ? boss.fireMs * 0.55 : boss.fireMs;
    }
  }

  function checkBulletBossCollisions() {
    if (!boss || !bullets.length) return;
    const keep = [];
    for (const b of bullets) {
      const br = { x: b.x, y: b.y, w: b.width, h: b.height };
      if (boss && rectsOverlap(br, boss)) {
        boss.hp -= b.dmg || 1;
        spawnExplosion(
          b.x + b.width / 2, b.y,
          b.mayo ? "rgb(255, 255, 250)" : "rgb(255, 230, 120)",
          b.mayo ? 12 : 5,
          b.mayo ? 6 : 3
        );
        if (boss.hp <= 0) defeatBoss();
        else sfx("bossHit");
        // bullet consumed
      } else {
        keep.push(b);
      }
    }
    bullets = keep;
  }

  function defeatBoss() {
    const bonus = 500 * boss.tier;
    Stats.score += bonus;
    checkHighScore();
    spawnExplosion(boss.x + boss.width / 2, boss.y + boss.height / 2, "rgb(120, 90, 60)", 46, 9);
    triggerShake(14, 600);
    triggerFlash("rgb(255, 255, 255)", 500);
    sfx("bossDie");
    boss = null;
    enemyShots = [];
  }

  // ---------------------------------------------------------------------------
  // Enemy slime fire
  // ---------------------------------------------------------------------------
  function spawnSlime(x, y, vx, vy) {
    enemyShots.push({ x: x, y: y, width: SLIME_W, height: SLIME_H, vx: vx || 0, vy: vy || SLIME_SPEED });
  }

  function updateEnemyFire() {
    if (boss || !aliens.length) return; // boss handles its own fire
    enemyFireMs -= elapsedMs;
    if (enemyFireMs > 0) return;
    enemyFireMs = ENEMY_FIRE_BASE_MS * Math.max(0.45, 1 - Stats.level * 0.04);
    // Exploding snailons only emit their 2-glob death burst - never random fire.
    const shooters = aliens.filter((a) => a.type !== "exploding");
    if (!shooters.length) return;
    const a = shooters[Math.floor(Math.random() * shooters.length)];
    spawnSlime(a.x + a.width / 2 - SLIME_W / 2, a.y + a.height, 0);
  }

  function updateEnemyShots(dt) {
    for (const s of enemyShots) {
      s.y += s.vy * dt;
      s.x += s.vx * dt;
    }
    enemyShots = enemyShots.filter((s) => s.y < Settings.screenHeight + 30);

    const sr = ship.rect();
    for (let i = 0; i < enemyShots.length; i++) {
      if (rectsOverlap(enemyShots[i], sr)) {
        enemyShots.splice(i, 1);
        shipHit();
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Power-ups
  // ---------------------------------------------------------------------------
  const POWERUP_COLORS = {
    rapid: "rgb(220, 120, 40)",
    spread: "rgb(60, 140, 210)",
    shield: "rgb(80, 160, 255)",
    life: "rgb(220, 60, 90)",
  };
  const POWERUP_LABELS = { rapid: "R", spread: "S", shield: "▲", life: "+" };

  function dropPowerup(cx, cy) {
    const r = Math.random();
    let type;
    if (r < 0.34) type = "rapid";
    else if (r < 0.68) type = "spread";
    else if (r < 0.9) type = "shield";
    else type = "life";
    powerups.push({
      x: cx - POWERUP_SIZE / 2,
      y: cy - POWERUP_SIZE / 2,
      width: POWERUP_SIZE,
      height: POWERUP_SIZE,
      type: type,
    });
  }

  function maybeDropPowerup(cx, cy) {
    if (Math.random() <= POWERUP_DROP_CHANCE) dropPowerup(cx, cy);
  }

  // Mayo easter egg: summon a mayo jar near the ship (once per level).
  function summonMayo() {
    mayoUsedThisLevel = true;
    setBanner("!מיונז");
    triggerFlash("rgb(255, 245, 180)", 450);
    sfx("mayo");
    const jarX = ship.centerx - MAYO_JAR_W / 2 + (Math.random() * 160 - 80);
    powerups.push({
      x: Math.max(10, Math.min(Settings.screenWidth - MAYO_JAR_W - 10, jarX)),
      y: -MAYO_JAR_H,
      width: MAYO_JAR_W,
      height: MAYO_JAR_H,
      type: "mayo",
    });
  }

  // Ambient "mayo rain": mayo boost jars drift down at random intervals all
  // level long. Independent of the typed easter egg (summonMayo) and its
  // once-per-level cap. Reuses the "mayo" powerup for fall/pickup/draw.
  function updateMayoRain() {
    mayoRainMs -= elapsedMs;
    if (mayoRainMs > 0) return;
    mayoRainMs = MAYO_RAIN_MIN_MS + Math.random() * (MAYO_RAIN_MAX_MS - MAYO_RAIN_MIN_MS);
    const jarX = 10 + Math.random() * (Settings.screenWidth - MAYO_JAR_W - 20);
    powerups.push({ x: jarX, y: -MAYO_JAR_H, width: MAYO_JAR_W, height: MAYO_JAR_H, type: "mayo" });
  }

  function updatePowerups(dt) {
    for (const p of powerups) p.y += POWERUP_FALL * dt;
    powerups = powerups.filter((p) => p.y < Settings.screenHeight + POWERUP_SIZE);

    const sr = ship.rect();
    for (let i = powerups.length - 1; i >= 0; i--) {
      if (rectsOverlap(powerups[i], sr)) {
        applyPowerup(powerups[i].type);
        powerups.splice(i, 1);
      }
    }
  }

  function applyPowerup(type) {
    sfx("powerup");
    if (type === "rapid") powerState.rapidMs = POWER_DURATION_MS;
    else if (type === "spread") powerState.spreadMs = POWER_DURATION_MS;
    else if (type === "shield") powerState.shield = true;
    else if (type === "life") Stats.shipsLeft = Math.min(Stats.shipsLeft + 1, 6);
    else if (type === "mayo") {
      powerState.mayoMs = MAYO_DURATION_MS;
      sfx("mayo");
    }
  }

  function tickPowerTimers() {
    if (powerState.rapidMs > 0) powerState.rapidMs -= elapsedMs;
    if (powerState.spreadMs > 0) powerState.spreadMs -= elapsedMs;
    if (powerState.mayoMs > 0) powerState.mayoMs -= elapsedMs;
    if (powerState.stunMs > 0) powerState.stunMs -= elapsedMs;
  }

  // ---------------------------------------------------------------------------
  // Speech-bubble taunts
  // ---------------------------------------------------------------------------
  function updateTaunts() {
    // Age existing bubbles.
    for (const t of taunts) t.ms -= elapsedMs;
    const stillTalking = (t) => t.target === boss || aliens.includes(t.target);
    // A snailon killed mid-taunt (unexpired bubble, speaker now gone) drops
    // its bubble instead of just vanishing.
    for (const t of taunts) {
      if (t.ms > 0 && !stillTalking(t)) spawnFallingBubble(t.target, t.text);
    }
    taunts = taunts.filter((t) => t.ms > 0 && stillTalking(t));

    tauntTimerMs -= elapsedMs;
    if (tauntTimerMs > 0) return;
    tauntTimerMs = 3000; // exactly one snailon speaks every 3 seconds
    if (taunts.length >= 1) return; // one bubble at a time

    let target = null;
    if (boss) target = boss;
    else if (aliens.length) target = aliens[Math.floor(Math.random() * aliens.length)];
    if (!target) return;
    taunts.push({ target: target, text: drawTaunt(), ms: 2800 });
  }

  // Shuffle-bag draw: every line in TAUNTS plays exactly once before any line
  // repeats, instead of a plain random pick (which can skip a line for a
  // long time by chance).
  function drawTaunt() {
    if (tauntBag.length === 0) {
      tauntBag = TAUNTS.slice();
      for (let i = tauntBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tauntBag[i], tauntBag[j]] = [tauntBag[j], tauntBag[i]];
      }
    }
    return tauntBag.pop();
  }

  function drawTaunts() {
    for (const tt of taunts) drawBubble(tt.target, tt.text);
  }

  // Rounded speech-bubble box, no tail (used as-is for the falling bubble;
  // drawBubble adds a tail on top of this for the live, attached bubble).
  function drawBubbleBox(bx, by, bw, bh, text) {
    const r = 10;
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = "rgb(60, 60, 60)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
    ctx.textAlign = "left";
  }

  function bubbleSize(text) {
    ctx.font = "20px Arial, sans-serif";
    return { width: ctx.measureText(text).width + 26, height: 36 };
  }

  function drawBubble(t, text) {
    const { width: bw, height: bh } = bubbleSize(text);
    let bx = t.x + t.width / 2 - bw / 2;
    bx = Math.max(6, Math.min(Settings.screenWidth - bw - 6, bx));
    let by = t.y - bh - 16;
    // The boss sits right under the top HUD (health bar, score, power-up
    // status), so a bubble placed above it would be hidden behind that HUD.
    // Always draw the boss's bubble below instead.
    const below = t === boss || by < 4;
    if (below) by = t.y + t.height + 16;

    drawBubbleBox(bx, by, bw, bh, text);

    // Tail pointing at the speaker, drawn on top of the box's border so it
    // blends into an opening in the outline.
    const tcx = Math.max(bx + 14, Math.min(bx + bw - 14, t.x + t.width / 2));
    ctx.beginPath();
    if (below) {
      ctx.moveTo(tcx - 7, by);
      ctx.lineTo(tcx, by - 12);
      ctx.lineTo(tcx + 7, by);
    } else {
      ctx.moveTo(tcx - 7, by + bh);
      ctx.lineTo(tcx, by + bh + 12);
      ctx.lineTo(tcx + 7, by + bh);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fill();
  }

  // ---------------------------------------------------------------------------
  // Falling speech bubbles: dropped by a snailon killed mid-taunt. Stuns the
  // ship (blocks movement/firing briefly) on contact instead of costing a life.
  // ---------------------------------------------------------------------------
  function spawnFallingBubble(target, text) {
    const { width: bw, height: bh } = bubbleSize(text);
    let bx = target.x + target.width / 2 - bw / 2;
    bx = Math.max(6, Math.min(Settings.screenWidth - bw - 6, bx));
    const by = target.y + target.height / 2 - bh / 2;
    fallingBubbles.push({ x: bx, y: by, width: bw, height: bh, text: text });
  }

  function updateFallingBubbles(dt) {
    for (const fb of fallingBubbles) fb.y += BUBBLE_FALL * dt;
    fallingBubbles = fallingBubbles.filter((fb) => fb.y < Settings.screenHeight + fb.height);

    const sr = ship.rect();
    for (let i = fallingBubbles.length - 1; i >= 0; i--) {
      if (rectsOverlap(fallingBubbles[i], sr)) {
        applyStun();
        fallingBubbles.splice(i, 1);
      }
    }
  }

  function drawFallingBubbles() {
    for (const fb of fallingBubbles) drawBubbleBox(fb.x, fb.y, fb.width, fb.height, fb.text);
  }

  function applyStun() {
    if (powerState.shield) {
      powerState.shield = false;
      sfx("shield");
      spawnExplosion(ship.centerx, ship.y + ship.height / 2, "rgb(80, 160, 255)", 16, 4);
      return;
    }
    powerState.stunMs = STUN_DURATION_MS;
    sfx("playerHit");
    triggerFlash("rgb(160, 60, 200)", 400);
    spawnExplosion(ship.centerx, ship.y + ship.height / 2, "rgb(200, 200, 210)", 14, 4);
  }

  // ---------------------------------------------------------------------------
  // Particles  (explosion sparks - visual only)
  // ---------------------------------------------------------------------------
  function spawnExplosion(cx, cy, color, count, maxSize) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1 + Math.random() * 4;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 500 + Math.random() * 300,
        maxLife: 800,
        size: 2 + Math.random() * (maxSize || 5),
        color: color,
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.05 * dt; // slight gravity
      p.life -= elapsedMs;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  // ---------------------------------------------------------------------------
  // Geometry helper (AABB overlap; args use either {x,y,w,h} or {x,y,width,height})
  // ---------------------------------------------------------------------------
  function rectsOverlap(a, b) {
    const aw = a.w != null ? a.w : a.width;
    const ah = a.h != null ? a.h : a.height;
    const bw = b.w != null ? b.w : b.width;
    const bh = b.h != null ? b.h : b.height;
    return a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y;
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------
  let respawnTimer = 0; // ms remaining of the post-hit freeze (port of sleep(0.5))
  let paused = false;
  let gameOverShown = false; // show "GAME OVER" wording only after a game has ended

  function clearPowerState() {
    powerState.rapidMs = 0;
    powerState.spreadMs = 0;
    powerState.shield = false;
    powerState.mayoMs = 0;
    powerState.stunMs = 0;
    fireCooldownMs = 0;
  }

  function startGame() {
    initAudio();
    startMusic();
    typedBuffer = "";
    mayoUsedThisLevel = false;
    taunts = [];
    tauntBag = [];
    tauntTimerMs = 1500;
    mayoRainMs = MAYO_RAIN_MIN_MS;
    shakeMs = 0;
    flashMs = 0;
    Settings.initializeDynamicSettings();
    Stats.resetStats();
    ship.speedLevel = SHIP_DEFAULT_SPEED_LEVEL;
    ship.centerShip();
    bullets = [];
    enemyShots = [];
    powerups = [];
    fallingBubbles = [];
    particles = [];
    boss = null;
    births = [];
    clearPowerState();
    respawnTimer = 0;
    paused = false;
    createFleet();
    Stats.gameActive = true;
    canvas.style.cursor = "none";
  }

  function startNextWave() {
    bullets = [];
    enemyShots = [];
    mayoUsedThisLevel = false; // the mayo summon recharges once per level
    Settings.increaseSpeed();
    Stats.level += 1;
    sfx("levelup");
    if (Stats.level % BOSS_EVERY === 0) createBoss();
    else createFleet();
  }

  function shipHit() {
    if (respawnTimer > 0 || !Stats.gameActive) return; // ignore during freeze / after death

    if (powerState.shield) {
      powerState.shield = false;
      sfx("shield");
      spawnExplosion(ship.centerx, ship.y + ship.height / 2, "rgb(80, 160, 255)", 16, 4);
      return; // shield absorbs the hit - no life lost, no freeze
    }

    Stats.shipsLeft -= 1;
    sfx("playerHit");
    triggerShake(10, 350);
    triggerFlash("rgb(255, 60, 60)", 400);
    spawnExplosion(ship.centerx, ship.y + ship.height / 2, "rgb(200, 200, 210)", 24, 6);
    if (Stats.shipsLeft <= 0) {
      gameOver();
      return;
    }

    bullets = [];
    enemyShots = [];
    if (!boss) {
      // Rebuild the fleet (boss fights keep the boss across a life loss).
      aliens = [];
      createFleet();
    }
    ship.centerShip();
    respawnTimer = 700; // brief freeze before play resumes
  }

  function gameOver() {
    Stats.gameActive = false;
    gameOverShown = true;
    aliens = [];
    bullets = [];
    enemyShots = [];
    powerups = [];
    fallingBubbles = [];
    boss = null;
    births = [];
    levelBannerMs = 0;
    taunts = [];
    clearPowerState();
    canvas.style.cursor = "default";
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const held = {}; // tracks keys held down to mimic pygame's non-repeating KEYDOWN

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Spacebar"].includes(k)) {
      e.preventDefault();
    }

    if (k === "Enter" && !Stats.gameActive) {
      startGame();
      return;
    }
    // Mayo easter egg: typing "מיונז" or "mayo" summons a mayo jar (once per
    // level). "nhubz" is the same physical keys as "מיונז" typed with the OS
    // keyboard set to English (Hebrew layout: מ=n, י=h, ו=u, נ=b, ז=z), so it
    // still works if someone types the Hebrew word without switching layout.
    // This must run before the "Escape/p" and "b" branches below, since "b"
    // is itself one of those physical keys and would otherwise never reach
    // the buffer.
    if (Stats.gameActive && k.length === 1) {
      typedBuffer = (typedBuffer + k.toLowerCase()).slice(-8);
      if (
        !mayoUsedThisLevel &&
        (typedBuffer.endsWith("מיונז") || typedBuffer.endsWith("mayo") || typedBuffer.endsWith("nhubz"))
      ) {
        summonMayo();
      }
    }

    if ((k === "Escape" || k === "p" || k === "P") && Stats.gameActive) {
      paused = !paused; // music keeps playing through the pause
      return;
    }
    // Music toggle ("b" — can't use "m", it's part of typing "mayo").
    if (k === "b" || k === "B" || k === "ב") {
      toggleMusic();
      return;
    }
    if (!Stats.gameActive) return;

    if (k === "ArrowRight") ship.movingRight = true;
    if (k === "ArrowLeft") ship.movingLeft = true;

    // One-shot actions: only on the initial press, not on auto-repeat.
    if (!held[k]) {
      if (k === "ArrowUp" && ship.speedLevel < SHIP_MAX_SPEED_LEVEL) ship.speedLevel += 1;
      if (k === "ArrowDown" && ship.speedLevel > 1) ship.speedLevel -= 1;
      if (k === " " || k === "Spacebar") fireWeapon();
    }
    held[k] = true;
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key;
    held[k] = false;
    if (k === "ArrowRight") ship.movingRight = false;
    if (k === "ArrowLeft") ship.movingLeft = false;
  });

  // Map a click to internal canvas coordinates (canvas is CSS-scaled).
  canvas.addEventListener("click", (e) => {
    if (Stats.gameActive) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    if (pointInPlayButton(x, y)) startGame();
  });

  // ---------------------------------------------------------------------------
  // Rendering  (ports scoreboard.py + button.py, plus the new HUD pieces)
  // ---------------------------------------------------------------------------
  const TEXT_COLOR = "rgb(30, 30, 30)";
  const SCORE_FONT = "36px Arial, sans-serif";

  function drawScoreboard() {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = SCORE_FONT;
    ctx.textBaseline = "top";

    // Score: top-right, rounded to nearest 10, comma-formatted.
    const rounded = Math.round(Stats.score / 10) * 10;
    const scoreStr = rounded.toLocaleString("en-US");
    ctx.textAlign = "right";
    ctx.fillText(scoreStr, Settings.screenWidth - 20, 20);

    // Level: below the score, right-aligned.
    ctx.fillText(String(Stats.level), Settings.screenWidth - 20, 64);

    // High score: centered at the top.
    ctx.textAlign = "center";
    const highStr = (Math.round(Stats.highScore / 10) * 10).toLocaleString("en-US");
    ctx.fillText(highStr, Settings.screenWidth / 2, 20);

    // Lives: one small salt-shaker icon + "N lives" text, top-left.
    const lifeW = 34;
    const lifeH = 42;
    ctx.drawImage(images.ship, 10, 10, lifeW, lifeH);
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "26px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(Stats.shipsLeft + " lives", 10 + lifeW + 8, 10 + lifeH / 2 + 1);
    ctx.textBaseline = "top";
  }

  // Speed meter: bottom-left (clear of the fleet and the centered ship).
  function drawSpeedMeter() {
    const x = 12;
    const cw = 16;
    const ch = 18;
    const gap = 4;
    const barY = Settings.screenHeight - 34;
    const y = barY - 30; // label sits above the bar

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "22px Arial, sans-serif";
    ctx.fillText("SPEED", x, y);

    for (let i = 0; i < SHIP_MAX_SPEED_LEVEL; i++) {
      const cx = x + i * (cw + gap);
      ctx.fillStyle = i < ship.speedLevel ? "rgb(40, 160, 40)" : "rgba(0, 0, 0, 0.12)";
      ctx.fillRect(cx, barY, cw, ch);
    }

    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "20px Arial, sans-serif";
    ctx.fillText(
      ship.speedLevel + " / " + SHIP_MAX_SPEED_LEVEL,
      x + SHIP_MAX_SPEED_LEVEL * (cw + gap) + 8,
      barY - 1
    );
  }

  // Draw one snailon: colored aura (type tint) + the shared sprite + a unique
  // canvas-drawn emblem, so each type is visually distinct without extra art.
  function drawAlien(a) {
    const cfg = SNAILON_TYPES[a.type] || SNAILON_TYPES.regular;
    if (cfg.aura) {
      ctx.fillStyle = cfg.aura;
      ctx.beginPath();
      ctx.ellipse(a.x + a.width / 2, a.y + a.height / 2, a.width * 0.62, a.height * 0.66, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.drawImage(images.alien, a.x, a.y, a.width, a.height);
    drawEmblem(a);
  }

  function drawEmblem(a) {
    const x = a.x;
    const y = a.y;
    const w = a.width;
    const h = a.height;
    const cx = x + w / 2;
    ctx.save();
    switch (a.type) {
      case "exploding": {
        const fx = x + w * 0.4;
        ctx.strokeStyle = "rgb(90, 60, 30)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(fx, y + 8); ctx.lineTo(fx, y - 6); ctx.stroke();
        ctx.fillStyle = "rgb(255, 170, 40)";
        ctx.beginPath(); ctx.arc(fx, y - 9, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgb(255, 240, 130)";
        ctx.beginPath(); ctx.arc(fx, y - 9, 2.5, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "armored": {
        ctx.fillStyle = "rgba(120, 130, 150, 0.9)";
        ctx.fillRect(x + w * 0.1, y + h * 0.26, w * 0.5, h * 0.36);
        ctx.fillStyle = "rgb(70, 80, 95)";
        for (const p of [[0.16, 0.34], [0.52, 0.34], [0.16, 0.56], [0.52, 0.56]]) {
          ctx.beginPath(); ctx.arc(x + w * p[0], y + h * p[1], 2.5, 0, Math.PI * 2); ctx.fill();
        }
        if (a.hp < a.maxHp) {
          ctx.strokeStyle = "rgb(220, 40, 40)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + w * 0.2, y + h * 0.3);
          ctx.lineTo(x + w * 0.38, y + h * 0.5);
          ctx.lineTo(x + w * 0.28, y + h * 0.6);
          ctx.stroke();
        }
        break;
      }
      case "splitter": {
        ctx.strokeStyle = "rgba(150, 70, 200, 0.95)";
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(cx, y + 4); ctx.lineTo(cx, y + h - 4); ctx.stroke();
        break;
      }
      case "fast": {
        ctx.strokeStyle = "rgba(40, 180, 200, 0.85)";
        ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          const yy = y + h * (0.32 + 0.2 * i);
          ctx.beginPath(); ctx.moveTo(x - 4 - i * 6, yy); ctx.lineTo(x - 18 - i * 6, yy); ctx.stroke();
        }
        break;
      }
      case "evil": {
        ctx.fillStyle = "rgb(120, 0, 0)";
        ctx.beginPath();
        ctx.moveTo(x + w * 0.30, y + 10); ctx.lineTo(x + w * 0.37, y - 8); ctx.lineTo(x + w * 0.45, y + 8);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + w * 0.55, y + 8); ctx.lineTo(x + w * 0.63, y - 8); ctx.lineTo(x + w * 0.70, y + 10);
        ctx.closePath(); ctx.fill();
        break;
      }
      case "king": {
        const cwn = w * 0.5;
        const x0 = x + w * 0.25;
        const y0 = y + 2;
        ctx.fillStyle = "rgb(240, 200, 40)";
        ctx.beginPath();
        ctx.moveTo(x0, y0 + 16);
        ctx.lineTo(x0, y0);
        ctx.lineTo(x0 + cwn * 0.25, y0 + 9);
        ctx.lineTo(x0 + cwn * 0.5, y0 - 4);
        ctx.lineTo(x0 + cwn * 0.75, y0 + 9);
        ctx.lineTo(x0 + cwn, y0);
        ctx.lineTo(x0 + cwn, y0 + 16);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgb(220, 60, 60)";
        ctx.beginPath(); ctx.arc(x0 + cwn * 0.5, y0 + 8, 2.5, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "woman": {
        const bx = cx;
        const by = y + 4;
        ctx.fillStyle = "rgb(240, 80, 170)";
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 16, by - 8); ctx.lineTo(bx - 16, by + 8); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 16, by - 8); ctx.lineTo(bx + 16, by + 8); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  function drawLevelBanner() {
    if (levelBannerMs <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, levelBannerMs / 500); // fade out over the last 0.5s
    ctx.fillStyle = "rgb(30, 30, 30)";
    ctx.font = "bold 56px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(levelName, Settings.screenWidth / 2, 230);
    ctx.restore();
  }

  function drawBoss() {
    if (!boss) return;
    ctx.drawImage(images.alien, boss.x, boss.y, boss.width, boss.height);
  }

  function drawBossHealth() {
    if (!boss) return;
    const barW = 700;
    const barH = 22;
    const x = (Settings.screenWidth - barW) / 2;
    const y = 70;
    ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    ctx.fillRect(x - 2, y - 2, barW + 4, barH + 4);
    ctx.fillStyle = "rgb(60, 60, 60)";
    ctx.fillRect(x, y, barW, barH);
    const frac = Math.max(0, boss.hp / boss.maxHp);
    ctx.fillStyle = frac > 0.33 ? "rgb(210, 70, 70)" : "rgb(240, 140, 40)";
    ctx.fillRect(x, y, barW * frac, barH);
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "20px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("GIANT SNAILON", Settings.screenWidth / 2, y - 4);
    ctx.textAlign = "left";
  }

  function drawPowerStatus() {
    const items = [];
    if (powerState.mayoMs > 0) items.push("מיונז " + Math.ceil(powerState.mayoMs / 1000) + "s");
    if (powerState.rapidMs > 0) items.push("RAPID " + Math.ceil(powerState.rapidMs / 1000) + "s");
    if (powerState.spreadMs > 0) items.push("SPREAD " + Math.ceil(powerState.spreadMs / 1000) + "s");
    if (powerState.shield) items.push("SHIELD");
    if (powerState.stunMs > 0) items.push("STUNNED " + Math.ceil(powerState.stunMs / 1000) + "s");
    if (!items.length) return;
    const py = boss ? 100 : 60;
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "22px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(items.join("    "), Settings.screenWidth / 2, py);
    ctx.textAlign = "left";
  }

  function drawEnemyShots() {
    ctx.fillStyle = "rgb(90, 170, 60)";
    for (const s of enemyShots) {
      ctx.beginPath();
      ctx.ellipse(s.x + s.width / 2, s.y + s.height / 2, s.width / 2, s.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPowerups() {
    for (const p of powerups) {
      if (p.type === "mayo") {
        // Mayo jar: white body, yellow lid, "מיונז" label.
        ctx.fillStyle = "rgb(250, 250, 245)";
        ctx.fillRect(p.x, p.y + 10, p.width, p.height - 10);
        ctx.strokeStyle = "rgb(120, 120, 110)";
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y + 10, p.width, p.height - 10);
        ctx.fillStyle = "rgb(240, 200, 60)";
        ctx.fillRect(p.x - 3, p.y, p.width + 6, 13);
        ctx.fillStyle = "rgb(60, 60, 60)";
        ctx.font = "bold 14px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("מיונז", p.x + p.width / 2, p.y + 10 + (p.height - 10) / 2);
        ctx.textAlign = "left";
        continue;
      }
      ctx.fillStyle = POWERUP_COLORS[p.type] || "rgb(120, 120, 120)";
      ctx.fillRect(p.x, p.y, p.width, p.height);
      ctx.fillStyle = "white";
      ctx.font = "bold 24px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POWERUP_LABELS[p.type] || "?", p.x + p.width / 2, p.y + p.height / 2 + 1);
      ctx.textAlign = "left";
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  const PLAY_BTN = { w: 200, h: 50 };
  function playButtonRect() {
    return {
      x: (Settings.screenWidth - PLAY_BTN.w) / 2,
      y: (Settings.screenHeight - PLAY_BTN.h) / 2,
      w: PLAY_BTN.w,
      h: PLAY_BTN.h,
    };
  }
  function pointInPlayButton(x, y) {
    const r = playButtonRect();
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  function drawMenu(isGameOver) {
    // Title
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "72px Arial, sans-serif";
    ctx.fillText("THE SNAILON INVASION", Settings.screenWidth / 2, 180);

    if (isGameOver) {
      ctx.font = "48px Arial, sans-serif";
      ctx.fillText("GAME OVER", Settings.screenWidth / 2, 270);
      ctx.font = "32px Arial, sans-serif";
      ctx.fillText(
        "Score: " + (Math.round(Stats.score / 10) * 10).toLocaleString("en-US"),
        Settings.screenWidth / 2,
        320
      );
    }

    // Play button (green, white text) - port of button.py
    const r = playButtonRect();
    ctx.fillStyle = "rgb(0, 255, 0)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.font = "36px Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("Play", Settings.screenWidth / 2, r.y + r.h / 2 + 2);

    // Controls / hints
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "24px Arial, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      "← → move    ↑ ↓ speed    Space: fire    Esc/P: pause    B: music",
      Settings.screenWidth / 2,
      r.y + r.h + 56
    );
    ctx.fillText(
      "Dodge the slime • grab power-ups • survive the GIANT SNAILON boss!",
      Settings.screenWidth / 2,
      r.y + r.h + 92
    );
    ctx.textAlign = "left";
  }

  function drawPaused() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(0, 0, Settings.screenWidth, Settings.screenHeight);
    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "64px Arial, sans-serif";
    ctx.fillText("PAUSED", Settings.screenWidth / 2, Settings.screenHeight / 2);
    ctx.font = "28px Arial, sans-serif";
    ctx.fillText(
      "Press Esc or P to resume",
      Settings.screenWidth / 2,
      Settings.screenHeight / 2 + 60
    );
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function render() {
    // Screen shake: jolt the whole frame while shakeMs runs down.
    const shaking = shakeMs > 0;
    if (shaking) {
      ctx.save();
      ctx.translate((Math.random() * 2 - 1) * shakeAmp, (Math.random() * 2 - 1) * shakeAmp);
    }

    ctx.fillStyle = Settings.bgColor;
    ctx.fillRect(-20, -20, Settings.screenWidth + 40, Settings.screenHeight + 40);

    // Player bullets (behind ship and enemies). Mayo globs render as blobs.
    for (const b of bullets) {
      if (b.mayo) {
        ctx.fillStyle = "rgb(250, 250, 240)";
        ctx.beginPath();
        ctx.ellipse(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgb(200, 195, 160)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle = Settings.bulletColor;
        ctx.fillRect(b.x, b.y, b.width, b.height);
      }
    }

    ship.draw();
    if (powerState.shield) {
      ctx.strokeStyle = "rgba(80, 160, 255, 0.85)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(ship.centerx, ship.y + ship.height / 2, ship.width, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const a of aliens) drawAlien(a);
    drawBoss();
    drawEnemyShots();
    drawPowerups();
    drawFallingBubbles();
    drawParticles();
    if (Stats.gameActive) drawTaunts();

    drawScoreboard();
    if (Stats.gameActive) {
      drawSpeedMeter();
      drawBossHealth();
      drawPowerStatus();
      drawLevelBanner();
    }

    if (!Stats.gameActive) {
      drawMenu(gameOverShown);
    } else if (paused) {
      drawPaused();
    }

    if (shaking) ctx.restore();

    // Full-screen flash overlay (screen space, unaffected by shake).
    if (flashMs > 0 && flashColor) {
      ctx.globalAlpha = 0.45 * Math.max(0, flashMs / flashDur);
      ctx.fillStyle = flashColor;
      ctx.fillRect(0, 0, Settings.screenWidth, Settings.screenHeight);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop  (port of run_game's while True)
  // ---------------------------------------------------------------------------
  let lastTime = null;
  const FRAME_MS = 1000 / 60; // baseline: original speeds are "pixels per 60fps frame"
  // The original pygame loop ran uncapped (well above 60fps), so its per-frame
  // speeds felt much brisker. Scale all motion up uniformly to restore that pace.
  // Bump this for a faster game, lower it for a slower one.
  const SPEED_SCALE = 3;

  function loop(timestamp) {
    if (lastTime === null) lastTime = timestamp;
    let elapsed = timestamp - lastTime;
    lastTime = timestamp;
    if (elapsed > 50) elapsed = 50; // clamp big gaps (tab switch)
    elapsedMs = elapsed;
    const dt = (elapsed / FRAME_MS) * SPEED_SCALE; // == SPEED_SCALE at 60fps

    if (Stats.gameActive && !paused) {
      if (respawnTimer > 0) {
        respawnTimer -= elapsed; // freeze gameplay during respawn
      } else {
        updateRapidFire();
        ship.update(dt);
        updateBullets(dt); // bullet-alien, bullet-boss, wave progression
        updateBoss(dt);
        if (Stats.gameActive) updateAliens(dt);
        updateSpecialSnailons(dt);
        updateEnemyFire();
        updateEnemyShots(dt);
        updatePowerups(dt);
        updateMayoRain();
        tickPowerTimers();
        updateTaunts();
        updateFallingBubbles(dt);
      }
      updateParticles(dt); // keep animating sparks even during the respawn freeze
      if (levelBannerMs > 0) levelBannerMs -= elapsedMs;
    }
    // Visual-effect timers always tick, so a flash/shake fades out even on the
    // game-over menu instead of freezing mid-effect.
    if (shakeMs > 0) shakeMs -= elapsedMs;
    if (flashMs > 0) flashMs -= elapsedMs;

    render();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------------
  // Boot: wait for both sprites to load, then start the loop on the menu.
  // ---------------------------------------------------------------------------
  let loaded = 0;
  function onImg() {
    loaded += 1;
    if (loaded === 2) requestAnimationFrame(loop);
  }
  for (const key of ["ship", "alien"]) {
    if (images[key].complete) onImg();
    else {
      images[key].onload = onImg;
      images[key].onerror = onImg; // start anyway; missing art shouldn't hard-block
    }
  }

  primeMusic(); // begin the music as early as the browser allows
})();
