/* =========================================
   1. КОНФИГУРАЦИЯ
   ========================================= */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Адаптивная ширина дорожек
let LANE_WIDTH = canvas.width / 3;
// Обновляем при ресайзе (хотя у нас фикс контейнер, полезно для мобилок)
window.addEventListener('resize', () => {
    LANE_WIDTH = canvas.width / 3;
});

const TRAIN_HEIGHT = 60;
const GRAVITY = 0.65;
const COLORS = { exp: '#ffaa00', trainGlowing: '#ff0055', boost: '#00f3ff', metalDark: '#1a1a2e', metalLight: '#3e4a61' };

/* --- AUDIO ENGINE --- */
class AudioController {
    constructor() {
        this.muted = false; this.sounds = {}; this.currentMusic = null; this.initialized = false;
        this.loadSound('menu', 'sounds/menu.mp3', true);
        this.loadSound('game', 'sounds/music.mp3', true);
        this.loadSound('gameover', 'sounds/gameover.mp3', false);
        this.loadSound('jump', 'sounds/jump.mp3');
        this.loadSound('coin', 'sounds/coin.mp3');
        this.loadSound('crash', 'sounds/crash.mp3');
        this.loadSound('dash', 'sounds/dash.mp3');
    }
    loadSound(name, path, loop=false) {
        const a = new Audio(); a.src = path; a.loop = loop; a.volume = (name==='menu'||name==='game')?0.3:0.6; a.preload='auto'; this.sounds[name]=a;
    }
    async init() {
        if(this.initialized) return; this.initialized=true; this.playMusic('menu');
    }
    playSfx(name) {
        if(this.muted || !this.sounds[name]) return;
        const s = this.sounds[name]; s.currentTime=0; s.play().catch(()=>{});
    }
    playMusic(name) {
        if(this.muted) return; if(this.currentMusic===name) return;
        this.stopMusic(); this.currentMusic=name;
        if(this.sounds[name]) { this.sounds[name].currentTime=0; this.sounds[name].play().catch(()=>{}); }
    }
    stopMusic() {
        if(this.currentMusic && this.sounds[this.currentMusic]) this.sounds[this.currentMusic].pause();
        this.currentMusic=null;
    }
    toggleMute() {
        this.muted = !this.muted;
        if(this.muted) this.stopMusic();
        else { if(gameRunning) this.playMusic('game'); else this.playMusic('menu'); }
        return this.muted;
    }
}
const audio = new AudioController();

// --- DATA ---
const SKINS_DB = {
    'h_def': { name: 'Неон', race: 'human', color: '#00f3ff', price: 0 },
    'h_agt': { name: 'Спектр', race: 'human', color: '#ff00ff', price: 150 },
    'h_gld': { name: 'Элита', race: 'human', color: '#ffd700', price: 1000 },
    'r_std': { name: 'Юнит-01', race: 'robot', color: '#ff9f43', price: 0 },
    'r_cyb': { name: 'Вектор', race: 'robot', color: '#54a0ff', price: 500 },
    'r_drk': { name: 'Титан', race: 'robot', color: '#ff4757', price: 1200 },
    'a_std': { name: 'Ксено', race: 'alien', color: '#1dd1a1', price: 0 },
    'a_gry': { name: 'Био', race: 'alien', color: '#a29bfe', price: 800 },
    'a_vld': { name: 'Войд', race: 'alien', color: '#fab1a0', price: 2000 }
};
let playerData = JSON.parse(localStorage.getItem('nr_mob_save')) || {
    coins: 0, inventory: ['h_def', 'r_std', 'a_std'], currentSkin: 'h_def', currentRace: 'human'
};
function saveGame() { localStorage.setItem('nr_mob_save', JSON.stringify(playerData)); }

// State
let gameRunning = false; let isPaused = false;
let frameCount = 0; let score = 0; let sessionCoins = 0; let gameSpeed = 5;
let player; let policeman; let objects = []; let particles = [];
const state = { threatLevel: 0, isStumbling: false, stumbleTimer: 0, superJumpTimer: 0, dashTimer: 0 };

/* =========================================
   2. UI & TOUCH CONTROLS
   ========================================= */
const uiSplash = document.getElementById('splash-screen');
const uiStart = document.getElementById('start-screen');
const uiHud = document.getElementById('game-hud');
const uiPause = document.getElementById('pause-menu');
const uiOver = document.getElementById('game-over-screen');

function initGameAudio() {
    audio.init();
    uiSplash.classList.add('hidden');
    uiStart.classList.remove('hidden');
    initShop();
}

function initShop() {
    document.getElementById('bank-total').innerText = playerData.coins;
    const grid = document.getElementById('skin-grid'); grid.innerHTML = '';
    document.querySelectorAll('.char-tab').forEach(b => {
        b.classList.toggle('active', b.innerText.toLowerCase().includes(
            playerData.currentRace === 'human' ? 'люди' : (playerData.currentRace === 'robot' ? 'роботы' : 'чужие')
        ));
    });
    for (let id in SKINS_DB) {
        const skin = SKINS_DB[id];
        if (skin.race !== playerData.currentRace) continue;
        const owned = playerData.inventory.includes(id);
        const selected = playerData.currentSkin === id;
        const card = document.createElement('div');
        card.className = `skin-card ${selected ? 'selected' : ''} ${!owned ? 'locked' : ''}`;
        card.innerHTML = `<div class="skin-preview" style="background:${skin.color}; box-shadow:0 0 10px ${skin.color}"></div><div style="font-size:12px;color:white;font-weight:bold">${skin.name}</div>${owned ? '' : `<div class="skin-price">${skin.price}</div>`}`;
        card.onclick = () => buyOrSelect(id);
        grid.appendChild(card);
    }
}
function switchChar(race) { playerData.currentRace = race; initShop(); }
function buyOrSelect(id) {
    if (playerData.inventory.includes(id)) playerData.currentSkin = id;
    else if (playerData.coins >= SKINS_DB[id].price) {
        playerData.coins -= SKINS_DB[id].price; playerData.inventory.push(id); playerData.currentSkin = id;
    } else return;
    saveGame(); initShop();
}
function toggleMute() {
    const m = audio.toggleMute(); document.getElementById('mute-btn').innerText = m ? '🔇' : '🔊';
}
function goToMenu() {
    gameRunning = false; audio.playMusic('menu');
    uiOver.classList.add('hidden'); uiPause.classList.add('hidden'); uiHud.classList.add('hidden'); uiStart.classList.remove('hidden');
    initShop();
}
function startGame() {
    uiStart.classList.add('hidden'); uiOver.classList.add('hidden'); uiHud.classList.remove('hidden');
    audio.playMusic('game');
    player = new Player(); policeman = new Policeman(); objects = []; particles = [];
    score = 0; sessionCoins = 0; gameSpeed = 5; frameCount = 0; state.threatLevel = 40;
    state.isStumbling = false; state.dashTimer = 0; state.superJumpTimer = 0;
    gameRunning = true; isPaused = false; animate();
}
function togglePause() {
    if(!gameRunning) return; isPaused = !isPaused;
    if(isPaused) { uiPause.classList.remove('hidden'); audio.stopMusic(); }
    else { uiPause.classList.add('hidden'); audio.playMusic('game'); animate(); }
}

// --- TOUCH HANDLING ---
let touchStartX = 0;
let touchStartY = 0;
let lastTapTime = 0;

canvas.addEventListener('touchstart', e => {
    if (!gameRunning || isPaused) return;
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    
}, {passive: false});

canvas.addEventListener('touchend', e => {
    if (!gameRunning || isPaused) return;
    let touchEndX = e.changedTouches[0].screenX;
    let touchEndY = e.changedTouches[0].screenY;
    handleGesture(touchStartX, touchStartY, touchEndX, touchEndY);
}, {passive: false});

function handleGesture(x1, y1, x2, y2) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    
    if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal Swipe
        if (Math.abs(dx) > 30) { // Threshold
            if (dx > 0) player.move(1); // Right
            else player.move(-1);       // Left
        }
    } else {
        // Vertical Swipe
        if (Math.abs(dy) > 30) {
            if (dy < 0) player.jump(); // Up
            // (dy > 0 could be roll in future)
        }
    }
}

// --- KEYBOARD HANDLING ---
window.addEventListener('keydown', e => {
    if(e.key==='Escape') togglePause();
    if(!gameRunning || isPaused) return;
    if(e.key==='ArrowLeft') player.move(-1);
    if(e.key==='ArrowRight') player.move(1);
    if(e.key==='ArrowUp') player.jump();
});

// Дополнительный обработчик клика для звука
document.body.addEventListener('click', () => { if (!audio.initialized) { audio.init(); if (!gameRunning && !audio.currentMusic) audio.playMusic('menu'); } }, { once: true });
switchChar('human'); initShop();

/* =========================================
   3. КЛАССЫ
   ========================================= */
class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        const angle = Math.random() * Math.PI * 2; const speed = Math.random() * 8 + 2;
        this.vx = Math.cos(angle) * speed; this.vy = Math.sin(angle) * speed - 5; 
        this.life = 1.0; this.size = Math.random() * 6 + 4;
    }
    update() { this.x += this.vx; this.y += this.vy; this.vy += 0.4; this.life -= 0.02; }
    draw() {
        ctx.save(); ctx.globalAlpha = this.life; ctx.fillStyle = this.color;
        ctx.translate(this.x, this.y); ctx.rotate(this.life * 5);
        ctx.fillRect(-this.size/2, -this.size/2, this.size, this.size);
        ctx.restore();
    }
}

class Player {
    constructor() {
        this.laneIndex = 1; this.width = 40; this.height = 70;
        this.x = (1 * LANE_WIDTH) + (LANE_WIDTH/2); this.y = canvas.height - 180;
        this.z = 0; this.dy = 0; this.groundLevel = 0; this.targetX = this.x;
    }
    update() {
        const target = (this.laneIndex * LANE_WIDTH) + (LANE_WIDTH/2);
        this.x += (target - this.x) * (state.isStumbling ? 0.08 : 0.2); 
        this.dy -= GRAVITY; this.z += this.dy;
        if (this.z <= this.groundLevel) { this.z = this.groundLevel; this.dy = 0; }
        let tY = canvas.height - 180; if(state.isStumbling) tY = canvas.height - 110;
        this.y += (tY - this.y) * 0.1;
        if(state.superJumpTimer>0) state.superJumpTimer--;
        if(state.dashTimer>0) { state.dashTimer--; if(state.dashTimer<=0) gameSpeed = Math.max(5, gameSpeed - 5); }
        updateHud();
    }
    draw() {
        ctx.save(); const drawY = this.y - this.z;
        const shadow = 1 - (this.z-this.groundLevel)/150;
        if(shadow>0) { ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.ellipse(this.x, this.y-this.groundLevel+15, 20*shadow, 8*shadow, 0, 0, Math.PI*2); ctx.fill(); }
        ctx.translate(this.x, drawY); const tilt = (this.x - ((this.laneIndex*LANE_WIDTH)+LANE_WIDTH/2)) * 0.08; ctx.rotate(-tilt * Math.PI / 180);
        const skin = SKINS_DB[playerData.currentSkin]; const color = state.dashTimer>0 ? '#fff' : (state.isStumbling ? '#ff0055' : skin.color);
        if(state.dashTimer>0) { ctx.shadowBlur = 25; ctx.shadowColor = "white"; }
        if(skin.race === 'robot') this.drawRobot(color); else if(skin.race === 'alien') this.drawAlien(color); else this.drawHuman(color);
        ctx.restore();
    }
    drawHuman(c) {
        const l = this.z > this.groundLevel + 5 ? 0 : Math.sin(frameCount * 0.4) * 12;
        ctx.fillStyle = COLORS.metalDark; ctx.fillRect(-14, 5, 10, 25 + l); ctx.fillStyle = c; ctx.fillRect(-14, 15 + l, 10, 5);
        ctx.fillStyle = COLORS.metalDark; ctx.fillRect(4, 5, 10, 25 - l); ctx.fillStyle = c; ctx.fillRect(4, 15 - l, 10, 5);
        let g = ctx.createLinearGradient(-15, 0, 15, 0); g.addColorStop(0, COLORS.metalDark); g.addColorStop(0.5, COLORS.metalLight); g.addColorStop(1, COLORS.metalDark);
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-15, -35); ctx.lineTo(15, -35); ctx.lineTo(10, 5); ctx.lineTo(-10, 5); ctx.fill();
        ctx.fillStyle = c; ctx.shadowBlur = 10; ctx.shadowColor = c; ctx.beginPath(); ctx.moveTo(-8, -25); ctx.lineTo(8, -25); ctx.lineTo(5, -15); ctx.lineTo(-5, -15); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = COLORS.metalLight; ctx.fillRect(-10, -55, 20, 20); ctx.fillStyle = c; ctx.shadowBlur = 15; ctx.shadowColor = c; ctx.fillRect(-8, -50, 16, 6); ctx.shadowBlur = 0;
    }
    drawRobot(c) {
        const l = this.z > this.groundLevel + 5 ? 0 : Math.sin(frameCount * 0.4) * 12;
        ctx.fillStyle = "#333"; ctx.fillRect(-14, 5, 8, 25 + l); ctx.fillRect(6, 5, 8, 25 - l);
        ctx.fillStyle = c; ctx.shadowBlur = 5; ctx.shadowColor = c; ctx.fillRect(-16, 15 + l, 12, 4); ctx.fillRect(4, 15 - l, 12, 4); ctx.shadowBlur = 0;
        ctx.fillStyle = COLORS.metalDark; ctx.beginPath(); ctx.moveTo(-20, -40); ctx.lineTo(20, -40); ctx.lineTo(15, 5); ctx.lineTo(-15, 5); ctx.fill();
        ctx.fillStyle = c; ctx.shadowBlur = 20; ctx.shadowColor = c; ctx.beginPath(); ctx.arc(0, -20, 8, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = COLORS.metalLight; ctx.fillRect(-12, -58, 24, 18); ctx.fillStyle = c; ctx.shadowBlur = 15; ctx.shadowColor = c; ctx.fillRect(-10, -53, 20, 5); ctx.shadowBlur = 0;
    }
    drawAlien(c) {
        const l = this.z > this.groundLevel + 5 ? 0 : Math.sin(frameCount * 0.4) * 12;
        ctx.shadowBlur = 10; ctx.shadowColor = c; ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-6, 5); ctx.lineTo(-12, 25 + l); ctx.lineTo(-18, 30 + l); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(6, 5); ctx.lineTo(12, 25 - l); ctx.lineTo(18, 30 - l); ctx.stroke();
        ctx.fillStyle = COLORS.metalDark; ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(12, -30); ctx.lineTo(8, 5); ctx.lineTo(-8, 5); ctx.lineTo(-12, -30); ctx.fill();
        ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8, -25); ctx.lineTo(8, -25); ctx.stroke();
        ctx.fillStyle = COLORS.metalDark; ctx.beginPath(); ctx.moveTo(0, -70); ctx.lineTo(10, -60); ctx.lineTo(5, -40); ctx.lineTo(-5, -40); ctx.lineTo(-10, -60); ctx.fill();
        ctx.fillStyle = c; ctx.shadowBlur = 20; ctx.beginPath(); ctx.ellipse(-7,-55, 3, 6, 0.3, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(7,-55, 3, 6, -0.3, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
    }
    move(dir) { if(!state.isStumbling) { let n=this.laneIndex+dir; if(n>=0 && n<3) this.laneIndex=n; } }
    jump() { if(this.z <= this.groundLevel + 10 && !state.isStumbling) { this.dy = state.superJumpTimer > 0 ? 22 : 15; audio.playSfx('jump'); } }
    activate(t) { if(t==='boots'){state.superJumpTimer=600;showMsg("HIGH JUMP");} if(t==='bolt'){state.dashTimer=200;gameSpeed+=5;state.threatLevel=0;showMsg("DASH!");audio.playSfx('dash');} }
}

class Ramp {
    constructor(lane, yPos) { this.type = 'ramp'; this.lane = lane; this.x = (lane*LANE_WIDTH)+(LANE_WIDTH/2); this.y = yPos; this.width = 50; this.height = 140; }
    update() { this.y+=gameSpeed; if(this.y>canvas.height+100) this.markedForDeletion=true; }
    draw() {
        ctx.save(); ctx.translate(this.x, this.y); ctx.strokeStyle = "#00f3ff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-25, -70); ctx.lineTo(25, -70); ctx.lineTo(25, 70); ctx.lineTo(-25, 70); ctx.closePath(); ctx.stroke();
        let g = ctx.createLinearGradient(0, -70, 0, 70); g.addColorStop(0, "rgba(0, 243, 255, 0.4)"); g.addColorStop(1, "rgba(0, 243, 255, 0.0)");
        ctx.fillStyle = g; ctx.fill(); ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-10, 20); ctx.lineTo(10, 20); ctx.fill(); ctx.restore();
    }
}

class Train {
    constructor(lane) {
        this.type='train'; this.lane=lane; this.length = Math.random()>0.7 ? 400 : (Math.random()>0.5?250:140);
        this.x = (lane*LANE_WIDTH)+(LANE_WIDTH/2); this.y = -400 - this.length; this.width = 50; this.height=this.length;
        this.color = Math.random()>0.5 ? COLORS.metalLight : '#2c3e50';
    }
    update() { this.y+=gameSpeed; if(this.y>canvas.height+this.length+200) this.markedForDeletion=true; }
    draw() {
        ctx.save(); ctx.translate(this.x, this.y); const hL = this.length/2; ctx.shadowBlur=20; ctx.shadowColor=this.color;
        let grad = ctx.createLinearGradient(-25,0,25,0); grad.addColorStop(0,"#000"); grad.addColorStop(0.5,this.color); grad.addColorStop(1,"#000");
        ctx.fillStyle = grad; ctx.fillRect(-25, -hL, 50, this.length); ctx.fillStyle=COLORS.metalDark; ctx.fillRect(-20, -hL+2, 40, this.length-4);
        ctx.fillStyle="rgba(0,243,255,0.2)"; for(let i=-hL+20; i<hL-20; i+=40) ctx.fillRect(-22, i, 44, 5);
        ctx.fillStyle=COLORS.trainGlowing; ctx.shadowColor=COLORS.trainGlowing; ctx.shadowBlur=15;
        ctx.beginPath(); ctx.arc(-15, hL-10, 5, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(15, hL-10, 5, 0, Math.PI*2); ctx.fill(); ctx.restore();
    }
}

class Coin {
    constructor(lane, yOff) { this.type='coin'; this.lane=lane; this.x=(lane*LANE_WIDTH)+(LANE_WIDTH/2); this.y=-50-yOff; this.rot=Math.random(); }
    update() { this.y+=gameSpeed; this.rot+=0.1; if(this.y>canvas.height+50) this.markedForDeletion=true; }
    draw() {
        ctx.save(); ctx.translate(this.x, this.y); ctx.scale(Math.sin(this.rot), 1);
        ctx.shadowBlur=15; ctx.shadowColor="#f1c40f"; ctx.fillStyle="#f1c40f"; 
        ctx.beginPath(); for(let i=0; i<8; i++){ ctx.rotate(Math.PI/4); ctx.fillRect(-5, -14, 10, 4); }
        ctx.arc(0,0,12,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#000"; ctx.font="bold 14px Arial"; ctx.fillText("C",-4,5); ctx.restore();
    }
}

class PowerUp {
    constructor(type) { this.type=type; this.lane=Math.floor(Math.random()*3); this.x=(this.lane*LANE_WIDTH)+(LANE_WIDTH/2); this.y=-50; this.bob=0; }
    update() { this.y+=gameSpeed; this.bob+=0.1; if(this.y>canvas.height+50) this.markedForDeletion=true; }
    draw() {
        ctx.save(); ctx.translate(this.x, this.y+Math.sin(this.bob)*5);
        const color = this.type==='boots'?'#0f0':COLORS.boost; ctx.shadowBlur=20; ctx.shadowColor=color; ctx.fillStyle=color;
        if(this.type==='boots') { ctx.beginPath(); ctx.moveTo(-12,-5); ctx.lineTo(12,-5); ctx.lineTo(8,12); ctx.lineTo(-8,12); ctx.fill(); } 
        else { ctx.beginPath(); ctx.moveTo(8,-15); ctx.lineTo(-8,0); ctx.lineTo(12,0); ctx.lineTo(-12,15); ctx.fill(); }
        ctx.restore();
    }
}

class Policeman {
    constructor(){ this.y=canvas.height+100; this.x=0; }
    update(p) {
        this.x += (p.x - this.x)*0.08;
        if(state.isStumbling) state.threatLevel+=2; else if(state.dashTimer>0) state.threatLevel=0; else state.threatLevel-=0.05;
        state.threatLevel = Math.max(0, Math.min(100, state.threatLevel));
        const vig = document.getElementById('danger-vignette');
        if(state.threatLevel>50) vig.classList.add('danger-active'); else vig.classList.remove('danger-active');
        const tY = canvas.height - (state.threatLevel*2.5) + 120; this.y += (tY - this.y)*0.1;
        if(state.threatLevel>=100) gameOver();
    }
    draw() {
        if(this.y>canvas.height+50) return;
        ctx.save(); ctx.translate(this.x, this.y); ctx.shadowBlur=15; ctx.shadowColor="red"; ctx.fillStyle="#101020"; ctx.fillRect(-25,-40,50,30);
        ctx.fillStyle="red"; ctx.fillRect(-20,-35,40,10); ctx.strokeStyle="red"; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(-25,-25); ctx.lineTo(-35,0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(25,-25); ctx.lineTo(35,0); ctx.stroke(); ctx.restore();
    }
}

/* =========================================
   4. GAME LOOP
   ========================================= */
function spawnObjects() {
    if(frameCount%180===0) {
        const lane = Math.floor(Math.random()*3);
        if(Math.random()<0.3) {
            const t = new Train(lane); const r = new Ramp(lane, 0);
            t.y = -400 - t.length/2; r.y = t.y + t.length/2 + 70; objects.push(t); objects.push(r);
        } else objects.push(new Train(lane));
    }
    if(frameCount%200===0) {
        const l = Math.floor(Math.random()*3); let safe=true; objects.forEach(o=>{if(Math.abs(o.y - (-200))<400 && o.lane===l) safe=false;});
        if(safe) for(let i=0;i<5;i++) objects.push(new Coin(l, i*40));
    }
    if(frameCount%500===0) objects.push(new PowerUp(Math.random()>0.5?'boots':'bolt'));
}

function explode(x, y, color) { audio.playSfx('crash'); for(let i=0; i<30; i++) particles.push(new Particle(x, y, color)); }

function checkCollisions() {
    let activeGroundLevel = 0;
    objects.forEach(obj => {
        if(obj.markedForDeletion) return;
        const dx = Math.abs(player.x - obj.x);
        if(obj.type==='coin'||obj.type==='boots'||obj.type==='bolt'){
            if(dx<30 && Math.abs((player.y-player.z)-obj.y)<40){
                obj.markedForDeletion=true; if(obj.type==='coin'){sessionCoins++;score+=10;audio.playSfx('coin');} else{player.activate(obj.type);score+=50;}
            } return;
        }
        if(obj.type==='ramp') {
             if (dx<30 && player.y>obj.y-70 && player.y<obj.y+70) {
                 let prog = (player.y-(obj.y-70))/140; prog = 1-prog; const rampH = prog*TRAIN_HEIGHT;
                 if(player.z<=rampH+10) activeGroundLevel = Math.max(activeGroundLevel, rampH);
             }
        }
        if(obj.type==='train') {
            const hitW = (player.width+obj.width)/2-5;
            if(dx<hitW) {
                const hL = obj.length/2;
                if(player.y>obj.y-hL && player.y<obj.y+hL) {
                    if(player.z>=TRAIN_HEIGHT-15) activeGroundLevel = Math.max(activeGroundLevel, TRAIN_HEIGHT);
                    else {
                        if(state.dashTimer>0) { explode(obj.x, obj.y+hL-20, obj.color); obj.markedForDeletion=true; score+=100; showMsg("DESTROYED!"); }
                        else {
                            const isSide = Math.abs(player.x-player.targetX)>5;
                            if(isSide) { state.isStumbling=true; state.stumbleTimer=40; gameSpeed=1; audio.playSfx('crash'); const dir = player.x<obj.x?-1:1; let nl=player.laneIndex+dir; player.laneIndex=Math.max(0,Math.min(2,nl)); player.x+=dir*40; }
                            else { audio.playSfx('crash'); gameOver(); }
                        }
                    }
                }
            }
        }
    });
    player.groundLevel = activeGroundLevel;
}

function updateHud() {
    document.getElementById('score').innerText = Math.floor(score).toString().padStart(4, '0');
    document.getElementById('coin-count').innerText = sessionCoins;
    const pb = document.getElementById('powerup-container'); const bar = document.getElementById('powerup-bar'); const ictx = document.getElementById('powerup-icon-canvas').getContext('2d');
    if(state.superJumpTimer>0 || state.dashTimer>0) {
        pb.classList.remove('hidden'); const max = state.superJumpTimer>0 ? 600 : 200; const cur = state.superJumpTimer>0 ? state.superJumpTimer : state.dashTimer;
        bar.style.width = (cur/max*100)+'%'; ictx.clearRect(0,0,24,24); ictx.fillStyle = state.superJumpTimer>0 ? '#0f0' : COLORS.boost;
        ictx.shadowBlur=10; ctx.shadowColor=ictx.fillStyle; ictx.beginPath(); ictx.arc(12,12,8,0,Math.PI*2); ictx.fill();
    } else pb.classList.add('hidden');
}

function showMsg(t) {
    const el = document.getElementById('center-msg'); el.innerText=t; el.classList.remove('hidden'); el.classList.remove('anim-pop');
    void el.offsetWidth; el.classList.add('anim-pop'); setTimeout(()=>el.classList.add('hidden'), 600);
}

function gameOver() {
    gameRunning = false; audio.playMusic('gameover');
    playerData.coins += sessionCoins; saveGame();
    document.getElementById('final-score').innerText = Math.floor(score); document.getElementById('final-coins').innerText = sessionCoins;
    uiOver.classList.remove('hidden');
}

function animate() {
    if(!gameRunning || isPaused) return;
    ctx.clearRect(0,0,canvas.width,canvas.height); frameCount++; score+=0.1;
    if(gameSpeed<12 && !state.isStumbling && state.dashTimer<=0) gameSpeed+=0.002;
    spawnObjects(); player.update(); policeman.update(player);
    objects.forEach(o=>o.update()); particles.forEach(p=>p.update());
    checkCollisions();
    objects = objects.filter(o=>!o.markedForDeletion); particles = particles.filter(p=>p.life>0);
    if(state.isStumbling) { state.stumbleTimer--; if(state.stumbleTimer<=0) state.isStumbling=false; if(gameSpeed<5) gameSpeed+=0.1; }
    ctx.lineWidth=2; ctx.strokeStyle="rgba(0,243,255,0.2)";
    for(let i=0;i<3;i++){let x=i*LANE_WIDTH+LANE_WIDTH/2; ctx.beginPath(); ctx.moveTo(x-LANE_WIDTH/2,0); ctx.lineTo(x-LANE_WIDTH/2,canvas.height); ctx.stroke();}
    let gridOffset = (frameCount*gameSpeed*2)%100; ctx.globalAlpha=0.3; for(let i=0; i<canvas.height; i+=100) { ctx.beginPath(); ctx.moveTo(0, i+gridOffset); ctx.lineTo(canvas.width, i+gridOffset); ctx.stroke(); } ctx.globalAlpha=1.0;
    let renderList = [...objects, player]; renderList.sort((a,b)=>a.y - b.y); renderList.forEach(o=>o.draw());
    policeman.draw(); ctx.globalCompositeOperation='lighter'; particles.forEach(p=>p.draw()); ctx.globalCompositeOperation='source-over';
    requestAnimationFrame(animate);
}