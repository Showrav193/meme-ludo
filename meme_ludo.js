const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ============================================================================
// 1. NATIVE BANGLA VOICE STREAM PROXY
// ============================================================================
app.get('/api/voice', (req, res) => {
    const text = req.query.text || 'খেলা হবে';
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=bn&client=tw-ob&q=' + encodeURIComponent(text);

    https.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
    }, (stream) => {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        stream.pipe(res);
    }).on('error', () => {
        res.status(500).end();
    });
});

// ============================================================================
// 2. SOCKET.IO MULTIPLAYER SERVER
// ============================================================================
const rooms = {};

function makeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const roomCode = makeCode();
        rooms[roomCode] = { roomCode, players: [{ id: socket.id, index: 0 }], turn: 0 };
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, playerIndex: 0 });
    });

    socket.on('joinRoom', ({ roomCode }) => {
        const code = (roomCode || '').toUpperCase().trim();
        const room = rooms[code];
        if (!room || room.players.length >= 2) {
            socket.emit('roomError', 'Room পাওয়া যায়নি বা ফুল হয়ে গেছে!');
            return;
        }
        room.players.push({ id: socket.id, index: 2 });
        socket.join(code);
        socket.emit('roomJoined', { roomCode: code, playerIndex: 2 });
        io.to(code).emit('startOnlineGame', { roomCode: code });
    });

    socket.on('onlineRoll', ({ roomCode, playerIndex }) => {
        const diceVal = Math.floor(Math.random() * 6) + 1;
        io.to(roomCode).emit('onlineDiceRolled', { playerIndex, diceVal });
    });

    socket.on('onlineMove', (data) => io.to(data.roomCode).emit('onlineTokenMoved', data));
    socket.on('sendTaunt', (data) => socket.to(data.roomCode).emit('receiveTaunt', data));
    socket.on('onlinePause', (data) => socket.to(data.roomCode).emit('receivePause', data));
    socket.on('onlineNewMatch', (data) => io.to(data.roomCode).emit('receiveNewMatch', data));
});

// ============================================================================
// 3. ULTRA-REALISTIC 3D TABLETOP FRONTEND (WITH PAUSE, SOLO/TEAM WIN & NEW MATCH)
// ============================================================================
const GAME_HTML = `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ludo Star Royal 3D - Realistic Tabletop Edition</title>
<style>
    @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@600;700&family=Poppins:wght@700;800;900&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Poppins', 'Hind Siliguri', sans-serif; user-select: none; }
    body {
        background: radial-gradient(circle at 50% 15%, #1e293b 0%, #090d16 55%, #020408 100%);
        color: #fff;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        overflow-x: hidden;
    }
    .app-shell {
        display: flex;
        gap: 24px;
        align-items: flex-start;
        justify-content: center;
        flex-wrap: wrap;
        max-width: 1320px;
        width: 100%;
    }
    .table-zone {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        perspective: 1200px;
    }
    .royal-header {
        width: 100%;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: linear-gradient(90deg, #271203, #5c2804, #271203);
        border: 2px solid #d97706;
        border-radius: 99px;
        padding: 6px 18px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.85), inset 0 1px 2px rgba(255,255,255,0.25);
    }
    .royal-header .prize {
        color: #fde047;
        font-weight: 900;
        font-size: 13px;
        text-shadow: 0 2px 4px #000;
    }
    .top-action-btns {
        display: flex;
        gap: 8px;
    }
    .top-btn {
        background: linear-gradient(180deg, #f59e0b, #b45309);
        border: 1.5px solid #fef08a;
        color: #fff;
        padding: 4px 12px;
        border-radius: 99px;
        font-size: 11.5px;
        font-weight: 900;
        cursor: pointer;
        box-shadow: 0 3px 10px rgba(0,0,0,0.5);
        transition: transform 0.1s;
    }
    .top-btn:hover { transform: scale(1.05); }
    .top-btn.new-btn { background: linear-gradient(180deg, #10b981, #047857); }

    .hud-grid {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
    }
    .p-hud {
        display: flex;
        align-items: center;
        gap: 10px;
        background: linear-gradient(145deg, #1e293b, #0f172a);
        border: 2px solid #334155;
        border-radius: 16px;
        padding: 8px 12px;
        position: relative;
        transition: all 0.25s;
        box-shadow: 0 10px 25px rgba(0,0,0,0.65);
    }
    .p-hud.active {
        border-color: #fbbf24;
        box-shadow: 0 0 25px rgba(251, 191, 36, 0.5);
        transform: translateY(-2px);
    }
    .p-hud.finished-player {
        border-color: #22c55e;
        background: linear-gradient(145deg, #064e3b, #0f172a);
    }
    .avatar-box {
        width: 46px;
        height: 46px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 25px;
        border: 2px solid rgba(255,255,255,0.85);
        box-shadow: inset 0 0 12px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.5);
    }
    .hud-meta { flex: 1; overflow: hidden; }
    .hud-name { font-size: 13px; font-weight: 900; display: flex; justify-content: space-between; align-items: center; }
    .team-tag {
        font-size: 9.5px;
        padding: 1px 6px;
        border-radius: 99px;
        margin-left: 5px;
        background: #4f46e5;
        color: #fff;
        display: none;
    }
    .hud-sub { font-size: 11px; color: #fde047; font-weight: 600; }
    .timer-track {
        width: 100%;
        height: 5px;
        background: #090d16;
        border-radius: 99px;
        margin-top: 5px;
        overflow: hidden;
    }
    .timer-fill {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #22c55e, #eab308, #ef4444);
        transition: width 0.2s linear;
    }
    .chat-bubble {
        position: absolute;
        top: -38px;
        left: 12px;
        background: #ffffff;
        color: #0f172a;
        padding: 5px 12px;
        border-radius: 14px;
        font-size: 12px;
        font-weight: 800;
        box-shadow: 0 10px 24px rgba(0,0,0,0.8);
        border: 2px solid #f59e0b;
        white-space: nowrap;
        z-index: 40;
        transform: scale(0);
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        pointer-events: none;
    }
    .chat-bubble.pop { transform: scale(1); }

    /* REALISTIC MAHOGANY & BRASS WOODEN BOARD CASING */
    .board-casing {
        position: relative;
        padding: 20px;
        border-radius: 26px;
        background:
            repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 2px, transparent 2px, transparent 8px),
            linear-gradient(135deg, #4a1c03 0%, #240c01 50%, #3d1602 100%);
        border: 5px solid #b45309;
        box-shadow:
            0 35px 75px rgba(0,0,0,0.95),
            0 12px 0 #1a0800,
            inset 0 2px 4px rgba(255,255,255,0.3),
            inset 0 0 30px rgba(0,0,0,0.85);
        transform: rotateX(7deg);
        transform-style: preserve-3d;
        transition: transform 0.2s ease;
    }
    .board-casing.shake {
        animation: heavyShake 0.55s cubic-bezier(.36,.07,.19,.97) both;
    }
    @keyframes heavyShake {
        10%, 90% { transform: rotateX(7deg) translate3d(-8px, 5px, 0) rotate(-1.5deg); }
        20%, 80% { transform: rotateX(7deg) translate3d(10px, -6px, 0) rotate(2deg); }
        30%, 50%, 70% { transform: rotateX(7deg) translate3d(-12px, -5px, 0) rotate(-2deg); }
        40%, 60% { transform: rotateX(7deg) translate3d(12px, 6px, 0) rotate(1.5deg); }
    }
    .brass-corner {
        position: absolute;
        width: 26px;
        height: 26px;
        border: 4px solid #fbbf24;
        pointer-events: none;
        z-index: 10;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,0.7));
    }
    .bc-tl { top: 6px; left: 6px; border-right: none; border-bottom: none; border-top-left-radius: 14px; }
    .bc-tr { top: 6px; right: 6px; border-left: none; border-bottom: none; border-top-right-radius: 14px; }
    .bc-bl { bottom: 6px; left: 6px; border-right: none; border-top: none; border-bottom-left-radius: 14px; }
    .bc-br { bottom: 6px; right: 6px; border-left: none; border-top: none; border-bottom-right-radius: 14px; }

    canvas {
        display: block;
        border-radius: 10px;
        box-shadow: inset 0 0 18px rgba(0,0,0,0.75), 0 0 0 2px #78350f;
        cursor: pointer;
    }
    .kill-flash {
        position: absolute;
        inset: 20px;
        border-radius: 10px;
        background: radial-gradient(circle, transparent 25%, rgba(220, 38, 38, 0.7) 100%);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s;
        z-index: 20;
    }
    .kill-flash.active { opacity: 1; }
    .center-meme-popup {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0);
        background: linear-gradient(135deg, #090d16, #3b0764);
        border: 3px solid #fde047;
        color: #fff;
        padding: 14px 28px;
        border-radius: 22px;
        font-size: 23px;
        font-weight: 900;
        text-align: center;
        pointer-events: none;
        z-index: 35;
        box-shadow: 0 25px 60px rgba(0,0,0,0.95);
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        white-space: nowrap;
    }
    .center-meme-popup.show { transform: translate(-50%, -50%) scale(1) rotate(-2deg); }

    /* PAUSE OVERLAY & GAME OVER VICTORY MODAL */
    .board-overlay {
        position: absolute;
        inset: 20px;
        border-radius: 10px;
        background: rgba(9, 13, 22, 0.88);
        backdrop-filter: blur(8px);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        z-index: 50;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
        padding: 24px;
        text-align: center;
    }
    .board-overlay.show {
        opacity: 1;
        pointer-events: auto;
    }
    .overlay-card {
        background: linear-gradient(160deg, #1e1b4b, #090d16);
        border: 3px solid #fbbf24;
        border-radius: 24px;
        padding: 26px 32px;
        max-width: 440px;
        width: 100%;
        box-shadow: 0 25px 60px rgba(0,0,0,0.95);
    }
    .overlay-title {
        font-size: 28px;
        font-weight: 900;
        color: #fde047;
        margin-bottom: 6px;
        text-shadow: 0 3px 8px rgba(0,0,0,0.8);
    }
    .overlay-sub {
        font-size: 13.5px;
        color: #cbd5e1;
        margin-bottom: 18px;
    }
    .podium-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 20px;
        text-align: left;
    }
    .podium-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(255,255,255,0.07);
        border: 1px solid rgba(255,255,255,0.15);
        padding: 9px 14px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 800;
    }
    .overlay-btns {
        display: flex;
        gap: 10px;
        justify-content: center;
    }
    .ov-btn {
        flex: 1;
        padding: 12px 16px;
        border-radius: 14px;
        border: 2px solid #fde047;
        font-size: 15px;
        font-weight: 900;
        cursor: pointer;
        transition: transform 0.12s;
    }
    .ov-btn:active { transform: scale(0.95); }
    .ov-btn.primary {
        background: linear-gradient(180deg, #22c55e, #15803d);
        color: #fff;
    }
    .ov-btn.secondary {
        background: linear-gradient(180deg, #facc15, #ca8a04);
        color: #090414;
    }

    .side-panel {
        width: 410px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .panel-card {
        background: linear-gradient(165deg, rgba(24, 30, 54, 0.96), rgba(10, 14, 26, 0.98));
        border: 1.5px solid rgba(251, 191, 36, 0.3);
        border-radius: 20px;
        padding: 14px 16px;
        box-shadow: 0 16px 35px rgba(0,0,0,0.7);
    }
    .card-head {
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: #fbbf24;
        margin-bottom: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    /* TRUE 3D TUMBLING DICE TRAY */
    .dice-row {
        display: flex;
        align-items: center;
        gap: 18px;
        background: radial-gradient(circle at center, #064e3b 0%, #022c22 100%);
        border: 3px solid #78350f;
        box-shadow: inset 0 6px 16px rgba(0,0,0,0.85);
        padding: 12px 16px;
        border-radius: 18px;
    }
    .scene-3d {
        width: 68px;
        height: 68px;
        perspective: 400px;
        cursor: pointer;
    }
    .cube-3d {
        width: 100%;
        height: 100%;
        position: relative;
        transform-style: preserve-3d;
        transform: translateZ(-34px) rotateX(-15deg) rotateY(20deg);
        transition: transform 0.55s cubic-bezier(0.22, 1.35, 0.36, 1);
    }
    .cube-face {
        position: absolute;
        width: 68px;
        height: 68px;
        background: radial-gradient(circle at 30% 30%, #ffffff 0%, #f1f5f9 65%, #cbd5e1 100%);
        border: 2px solid #94a3b8;
        border-radius: 14px;
        box-shadow: inset 0 0 8px rgba(0,0,0,0.22);
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(3, 1fr);
        padding: 9px;
        backface-visibility: hidden;
    }
    .face-1 { transform: rotateY(0deg) translateZ(34px); }
    .face-2 { transform: rotateY(180deg) translateZ(34px); }
    .face-3 { transform: rotateY(90deg) translateZ(34px); }
    .face-4 { transform: rotateY(-90deg) translateZ(34px); }
    .face-5 { transform: rotateX(90deg) translateZ(34px); }
    .face-6 { transform: rotateX(-90deg) translateZ(34px); }

    .pip {
        width: 11px;
        height: 11px;
        border-radius: 50%;
        place-self: center;
        background: radial-gradient(circle at 35% 35%, #334155, #090d16);
        box-shadow: inset 0 2px 3px rgba(0,0,0,0.8), 0 1px 1px rgba(255,255,255,0.6);
    }
    .pip.red {
        width: 14px;
        height: 14px;
        background: radial-gradient(circle at 35% 35%, #ef4444, #991b1b);
    }

    .roll-button {
        flex: 1;
        height: 70px;
        border: 2px solid #fef08a;
        border-radius: 16px;
        background: linear-gradient(180deg, #facc15 0%, #ca8a04 55%, #a16207 100%);
        color: #090414;
        font-size: 19px;
        font-weight: 900;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(0,0,0,0.6), inset 0 2px 2px rgba(255,255,255,0.6);
        transition: transform 0.1s;
    }
    .roll-button:active { transform: scale(0.96); }
    .roll-button:disabled { filter: grayscale(0.85) opacity(0.45); cursor: not-allowed; }

    .filter-pills { display: flex; gap: 6px; margin-bottom: 10px; }
    .pill {
        flex: 1;
        padding: 6px 4px;
        border-radius: 8px;
        border: 1px solid #475569;
        background: #1e293b;
        color: #cbd5e1;
        font-size: 11px;
        font-weight: 800;
        text-align: center;
        cursor: pointer;
    }
    .pill.active { background: #be123c; border-color: #fda4af; color: #fff; }

    .meme-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        max-height: 190px;
        overflow-y: auto;
        padding-right: 2px;
    }
    .meme-btn {
        background: linear-gradient(135deg, #2e1065, #1e1b4b);
        border: 1px solid rgba(244, 63, 94, 0.55);
        color: #fecdd3;
        padding: 8px 10px;
        border-radius: 10px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        text-align: left;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.15s;
    }
    .meme-btn:hover { background: #be123c; color: #fff; border-color: #fde047; transform: translateY(-1px); }

    .studio-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(0,0,0,0.45);
        padding: 6px 10px;
        border-radius: 10px;
        margin-top: 6px;
        font-size: 11.5px;
    }
    .mini-btn {
        background: #ef4444;
        color: #fff;
        border: none;
        padding: 4px 9px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
    }
    .mini-btn.rec { background: #22c55e; animation: blink 0.7s infinite; }
    @keyframes blink { 50% { opacity: 0.4; } }
    .mp3-lbl {
        background: #2563eb;
        color: #fff;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
    }
    .mp3-lbl input { display: none; }
    .opt-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; padding: 4px 0; }
    .mode-bar { display: flex; gap: 6px; margin-bottom: 6px; }
    .mode-btn {
        flex: 1;
        padding: 7px 4px;
        border-radius: 8px;
        border: 1px solid #475569;
        background: #1e293b;
        color: #fff;
        font-weight: 800;
        font-size: 11px;
        cursor: pointer;
    }
    .mode-btn.active { background: #7c3aed; border-color: #ddd6fe; }
</style>
</head>
<body>

<div class="app-shell">
    <div class="table-zone">
        <div class="royal-header">
            <span>👑 <b>LUDO STAR ROYAL 3D</b></span>
            <div class="top-action-btns">
                <button class="top-btn" id="pauseBtn" onclick="togglePauseGame()">⏸️ PAUSE (P)</button>
                <button class="top-btn new-btn" onclick="startNewMatch()">🔄 NEW MATCH</button>
            </div>
        </div>

        <div class="hud-grid">
            <div class="p-hud active" id="hud-0">
                <div class="chat-bubble" id="bubble-0">🔥 খেলা হবে!</div>
                <div class="avatar-box" style="background:#dc2626;">😎</div>
                <div class="hud-meta">
                    <div class="hud-name">
                        <span>RED BOSS <span class="team-tag" id="ttag-0">TEAM A</span></span>
                        <span id="score-0">0/4 Home</span>
                    </div>
                    <div class="hud-sub" id="status-0">Your Turn! Roll Dice</div>
                    <div class="timer-track"><div class="timer-fill" id="timer-0"></div></div>
                </div>
            </div>

            <div class="p-hud" id="hud-2">
                <div class="chat-bubble" id="bubble-2">😈 আয় সামনে আয়!</div>
                <div class="avatar-box" style="background:#ca8a04;">🤬</div>
                <div class="hud-meta">
                    <div class="hud-name">
                        <span><span id="name-2">SAVAGE BOT</span> <span class="team-tag" id="ttag-2">TEAM A</span></span>
                        <span id="score-2">0/4 Home</span>
                    </div>
                    <div class="hud-sub" id="status-2">Waiting...</div>
                    <div class="timer-track"><div class="timer-fill" id="timer-2"></div></div>
                </div>
            </div>

            <div class="p-hud" id="hud-1" style="display:none;">
                <div class="chat-bubble" id="bubble-1"></div>
                <div class="avatar-box" style="background:#16a34a;">🥷</div>
                <div class="hud-meta">
                    <div class="hud-name">
                        <span>GREEN VIPER <span class="team-tag" id="ttag-1" style="background:#059669;">TEAM B</span></span>
                        <span id="score-1">0/4 Home</span>
                    </div>
                    <div class="hud-sub" id="status-1">Waiting...</div>
                    <div class="timer-track"><div class="timer-fill" id="timer-1"></div></div>
                </div>
            </div>

            <div class="p-hud" id="hud-3" style="display:none;">
                <div class="chat-bubble" id="bubble-3"></div>
                <div class="avatar-box" style="background:#2563eb;">🦁</div>
                <div class="hud-meta">
                    <div class="hud-name">
                        <span>BLUE KING <span class="team-tag" id="ttag-3" style="background:#059669;">TEAM B</span></span>
                        <span id="score-3">0/4 Home</span>
                    </div>
                    <div class="hud-sub" id="status-3">Waiting...</div>
                    <div class="timer-track"><div class="timer-fill" id="timer-3"></div></div>
                </div>
            </div>
        </div>

        <div class="board-casing" id="boardCasing">
            <div class="brass-corner bc-tl"></div>
            <div class="brass-corner bc-tr"></div>
            <div class="brass-corner bc-bl"></div>
            <div class="brass-corner bc-br"></div>
            <canvas id="ludoCanvas" width="600" height="600"></canvas>
            <div class="kill-flash" id="killFlash"></div>
            <div class="center-meme-popup" id="memePopup">💀 হালার পুত বাড়িত যা!</div>

            <!-- PAUSE OVERLAY MODAL -->
            <div class="board-overlay" id="pauseOverlay">
                <div class="overlay-card">
                    <div class="overlay-title">⏸️ GAME PAUSED</div>
                    <div class="overlay-sub">খেলা আপাতত পজ করা আছে। চা-নাস্তা খেয়ে আবার শুরু করো!</div>
                    <div class="overlay-btns">
                        <button class="ov-btn primary" onclick="togglePauseGame()">▶️ RESUME GAME</button>
                        <button class="ov-btn secondary" onclick="startNewMatch()">🔄 NEW MATCH</button>
                    </div>
                </div>
            </div>

            <!-- GAME FINISHED / VICTORY PODIUM OVERLAY MODAL -->
            <div class="board-overlay" id="gameOverOverlay">
                <div class="overlay-card">
                    <div class="overlay-title" id="winTitle">🏆 MATCH FINISHED!</div>
                    <div class="overlay-sub" id="winSubtitle">সবাইকে হারিয়ে বাজিমাত!</div>
                    <div class="podium-list" id="podiumList"></div>
                    <div class="overlay-btns">
                        <button class="ov-btn primary" onclick="startNewMatch()">🔄 PLAY NEW MATCH</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="side-panel">
        <div class="panel-card">
            <div class="card-head">
                <span id="turnIndicator">🔴 RED'S TURN</span>
                <span id="gameModeBadge">VS SAVAGE BOT</span>
            </div>
            <div class="dice-row">
                <div class="scene-3d" onclick="triggerRoll()">
                    <div class="cube-3d" id="cube3D">
                        <div class="cube-face face-1">
                            <div></div><div></div><div></div>
                            <div></div><div class="pip red"></div><div></div>
                            <div></div><div></div><div></div>
                        </div>
                        <div class="cube-face face-2">
                            <div class="pip"></div><div></div><div></div>
                            <div></div><div></div><div></div>
                            <div></div><div></div><div class="pip"></div>
                        </div>
                        <div class="cube-face face-3">
                            <div class="pip"></div><div></div><div></div>
                            <div></div><div class="pip"></div><div></div>
                            <div></div><div></div><div class="pip"></div>
                        </div>
                        <div class="cube-face face-4">
                            <div class="pip"></div><div></div><div class="pip"></div>
                            <div></div><div></div><div></div>
                            <div class="pip"></div><div></div><div class="pip"></div>
                        </div>
                        <div class="cube-face face-5">
                            <div class="pip"></div><div></div><div class="pip"></div>
                            <div></div><div class="pip"></div><div></div>
                            <div class="pip"></div><div></div><div class="pip"></div>
                        </div>
                        <div class="cube-face face-6">
                            <div class="pip red"></div><div></div><div class="pip red"></div>
                            <div class="pip red"></div><div></div><div class="pip red"></div>
                            <div class="pip red"></div><div></div><div class="pip red"></div>
                        </div>
                    </div>
                </div>
                <button class="roll-button" id="rollBtn" onclick="triggerRoll()">
                    🎲 ROLL 3D DICE<br><span style="font-size:11px;font-weight:700;">(SPACEBAR OR CLICK)</span>
                </button>
            </div>
        </div>

        <div class="panel-card">
            <div class="card-head">
                <span>🌐 GAME MODE (SOLO / 2v2 TEAM / ONLINE)</span>
            </div>
            <div class="mode-bar">
                <button class="mode-btn active" id="btnModeBot" onclick="changeMode('BOT')">🤖 1v1 Bot</button>
                <button class="mode-btn" id="btnModePass" onclick="changeMode('PASS')">👤 4P Solo</button>
                <button class="mode-btn" id="btnModeTeam" onclick="changeMode('TEAM')">🤝 2v2 Team</button>
            </div>
            <div style="display:flex; gap:6px; margin-bottom:6px;">
                <button class="mode-btn" style="background:#d97706;border-color:#fde047;" onclick="togglePauseGame()" id="sidePauseBtn">⏸️ Pause Match</button>
                <button class="mode-btn" style="background:#059669;border-color:#6ee7b7;" onclick="startNewMatch()">🔄 Start New Match</button>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="mode-btn" onclick="createRoom()">Create Online Room</button>
                <input id="roomInp" placeholder="CODE" maxlength="5" style="width:85px;background:#090414;border:1px solid #475569;color:#fde047;border-radius:8px;padding:6px;font-weight:900;text-transform:uppercase;">
                <button class="mode-btn" onclick="joinRoom()">Join</button>
            </div>
            <div id="roomMsg" style="font-size:11px;color:#38bdf8;margin-top:5px;"></div>
        </div>

        <div class="panel-card">
            <div class="card-head">
                <span>🔥 12 VIRAL BANGLA MEME & GALI VOICES</span>
                <span style="color:#4ade80;font-size:10px;">REAL AUDIO ENGINE</span>
            </div>

            <div class="filter-pills">
                <div class="pill active" id="vmode-savage" onclick="setVoiceMode('savage')">🔥 Desi Natural</div>
                <div class="pill" id="vmode-bass" onclick="setVoiceMode('bass')">🔊 Savage Bass</div>
                <div class="pill" id="vmode-funny" onclick="setVoiceMode('funny')">🐿️ Funny Meme</div>
            </div>

            <div class="meme-grid">
                <button class="meme-btn" onclick="triggerViralMeme('kill1')">💀 হালার পুত বাড়িত যা!</button>
                <button class="meme-btn" onclick="triggerViralMeme('kill2')">🔥 ধরে ভরে দিছি রে!</button>
                <button class="meme-btn" onclick="triggerViralMeme('kill3')">😂 কী সুন্দর গুটি খাইলাম!</button>
                <button class="meme-btn" onclick="triggerViralMeme('six1')">🚀 মামা ছক্কা মাইরা দে!</button>
                <button class="meme-btn" onclick="triggerViralMeme('six2')">👑 খানকির পোলার কপাল!</button>
                <button class="meme-btn" onclick="triggerViralMeme('one1')">😭 হোগা মারা সারা! (১)</button>
                <button class="meme-btn" onclick="triggerViralMeme('one2')">🐸 ধূর বাল! কপালই খারাপ!</button>
                <button class="meme-btn" onclick="triggerViralMeme('trap1')">😈 আয় শালার পুত সামনে আয়!</button>
                <button class="meme-btn" onclick="triggerViralMeme('taunt1')">🤡 কান্দিস না বাচ্চা পোলা!</button>
                <button class="meme-btn" onclick="triggerViralMeme('taunt2')">👀 লজ্জা করে না তোর?</button>
                <button class="meme-btn" onclick="triggerViralMeme('home1')">🏆 তোর আব্বা আসছি রে!</button>
                <button class="meme-btn" onclick="triggerViralMeme('pen1')">🤯 তিন ছক্কায় চাল বাতিল!</button>
            </div>
        </div>

        <div class="panel-card">
            <div class="card-head">
                <span>🎙️ CUSTOM VOICE RECORDER & AUDIO SETTINGS</span>
            </div>
            <div class="studio-bar">
                <span>💀 <b>Kill Sound:</b> <small id="lbl-kill" style="color:#fde047;">Viral Bangla Pack</small></span>
                <div>
                    <button class="mini-btn" id="rec-kill" onclick="recordCustom('kill')">🎙️ Rec</button>
                    <label class="mp3-lbl">📁 MP3 <input type="file" accept="audio/*" onchange="uploadMP3(event,'kill')"></label>
                </div>
            </div>
            <div class="studio-bar">
                <span>🔥 <b>Six Sound:</b> <small id="lbl-six" style="color:#fde047;">Viral Bangla Pack</small></span>
                <div>
                    <button class="mini-btn" id="rec-six" onclick="recordCustom('six')">🎙️ Rec</button>
                    <label class="mp3-lbl">📁 MP3 <input type="file" accept="audio/*" onchange="uploadMP3(event,'six')"></label>
                </div>
            </div>

            <div style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:6px;">
                <div class="opt-row">
                    <span>🔊 Master Tabletop & Foley Audio</span>
                    <input type="checkbox" id="chkMaster" checked>
                </div>
                <div class="opt-row">
                    <span>🤬 Viral Meme & Gali Voices (On/Off)</span>
                    <input type="checkbox" id="chkMeme" checked>
                </div>
                <div class="opt-row">
                    <span>🔇 Mute Opponent Taunts</span>
                    <input type="checkbox" id="chkMuteOpp">
                </div>
            </div>
        </div>
    </div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let voiceFilterMode = 'savage';
let currentVoiceAudio = null;

function ensureAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function setVoiceMode(mode) {
    voiceFilterMode = mode;
    ['savage', 'bass', 'funny'].forEach(m => {
        document.getElementById('vmode-' + m).classList.toggle('active', m === mode);
    });
}

function playRealisticFoley(type) {
    if (!document.getElementById('chkMaster').checked) return;
    ensureAudio();
    const now = audioCtx.currentTime;

    if (type === 'dice_tumble') {
        const hits = [0, 0.06, 0.13, 0.21, 0.31, 0.43];
        hits.forEach((delay, idx) => {
            const t = now + delay;
            const bufSize = audioCtx.sampleRate * 0.025;
            const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.3));
            }
            const noise = audioCtx.createBufferSource();
            noise.buffer = buf;

            const filter = audioCtx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(1100 + idx * 140, t);
            filter.Q.setValueAtTime(3.5, t);

            const gain = audioCtx.createGain();
            const vol = Math.max(0.08, 0.42 - idx * 0.055);
            gain.gain.setValueAtTime(vol, t);
            gain.gain.exponentialRampToValueAtTime(0.005, t + 0.024);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(audioCtx.destination);
            noise.start(t);
        });
    } else if (type === 'wood_step') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(195, now);
        osc.frequency.exponentialRampToValueAtTime(68, now + 0.065);
        gain.gain.setValueAtTime(0.38, now);
        gain.gain.exponentialRampToValueAtTime(0.008, now + 0.07);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.075);
    }
}

const VIRAL_MEMES = {
    kill1: {
        banner: "💀 হালার পুত সোজা বাড়িত যা!",
        speech: "হালার পুত, সোজা বাড়িত যা! টাটা বাই বাই!",
        stinger: "vineboom",
        emojis: "💀🔥⚰️"
    },
    kill2: {
        banner: "🔥 ধরে ভরে দিছি রে! গুটি শেষ!",
        speech: "ধরে ভরে দিছি রে! তোর গুটি একেবারে শেষ!",
        stinger: "coffin",
        emojis: "🔥😈💀"
    },
    kill3: {
        banner: "😂 ওমা গো! কী সুন্দর গুটি খাইলাম!",
        speech: "ওমা গো! কী সুন্দর গুটি খাইয়া দিলাম রে!",
        stinger: "laugh",
        emojis: "😂🤣👻"
    },
    six1: {
        banner: "🚀 খেলা হবে! মামা ছক্কা মাইরা দে!",
        speech: "খেলা হবে! মামা ছক্কা মাইরা ভরে দে!",
        stinger: "airhorn",
        emojis: "🚀🎲🔥"
    },
    six2: {
        banner: "👑 খানকির পোলার কপাল দেখ! ছক্কা!",
        speech: "খানকির পোলার কপাল দেখ! আবার ছক্কা মারছে!",
        stinger: "airhorn",
        emojis: "👑⚡🎲"
    },
    one1: {
        banner: "😭 হোগা মারা সারা! আবার ১!",
        speech: "হোগা মারা সারা! শালা আবার এক উঠছে রে!",
        stinger: "violin",
        emojis: "😭🐸💔"
    },
    one2: {
        banner: "🐸 ধূর বাল! কপালটাই কুত্তার!",
        speech: "ধূর বাল! এই কপাল নিয়া লুডু খেলতে আসছিস?",
        stinger: "trombone",
        emojis: "🐸🤡💩"
    },
    trap1: {
        banner: "😈 আয় শালার পুত সামনে আয়!",
        speech: "আয় শালার পুত সামনে আয়, তোর যম দাঁড়ায় আছে!",
        stinger: "vineboom",
        emojis: "😈🔪👀"
    },
    taunt1: {
        banner: "🤡 কান্দিস না বাচ্চা পোলা, আব্বু ডাক দে!",
        speech: "কান্দিস না বাচ্চা পোলা, টিস্যু নে, আব্বু ডাক দে!",
        stinger: "laugh",
        emojis: "🤡🍼😂"
    },
    taunt2: {
        banner: "👀 এতগুলা গুটি খাইয়া লজ্জা করে না?",
        speech: "এতগুলা গুটি খাইয়া একটুও লজ্জা করে না তোর?",
        stinger: "vineboom",
        emojis: "👀🤦‍♂️🔥"
    },
    home1: {
        banner: "🏆 তোর আব্বা আসছি রে! মুই বস্!",
        speech: "তোর আব্বা আসছি রে! মুই বস্, তোদের খেলা শেষ!",
        stinger: "fanfare",
        emojis: "🏆👑🎉"
    },
    pen1: {
        banner: "🤯 তিনবার ছক্কা! চাল বাতিল!",
        speech: "শালা তিনবার ছক্কা মাইরা চালই বাতিল করে দিলি!",
        stinger: "trombone",
        emojis: "🤯🚫😭"
    }
};

function playViralStinger(stingerType) {
    ensureAudio();
    const now = audioCtx.currentTime;

    if (stingerType === 'vineboom') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.65);
        gain.gain.setValueAtTime(0.85, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.68);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(now); osc.stop(now + 0.7);
    } else if (stingerType === 'coffin') {
        const notes = [349.23, 349.23, 523.25, 466.16, 440.00, 392.00];
        notes.forEach((f, i) => {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f, now + i * 0.11);
            g.gain.setValueAtTime(0.18, now + i * 0.11);
            g.gain.exponentialRampToValueAtTime(0.01, now + (i + 1) * 0.11);
            osc.connect(g); g.connect(audioCtx.destination);
            osc.start(now + i * 0.11); osc.stop(now + (i + 1) * 0.11);
        });
    } else if (stingerType === 'airhorn') {
        [480, 600, 720].forEach(f => {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f * 0.92, now);
            osc.frequency.linearRampToValueAtTime(f, now + 0.08);
            g.gain.setValueAtTime(0.14, now);
            g.gain.exponentialRampToValueAtTime(0.01, now + 0.48);
            osc.connect(g); g.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.5);
        });
    } else if (stingerType === 'violin') {
        const notes = [659.25, 622.25, 587.33, 523.25];
        notes.forEach((f, i) => {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = 'triangle';
            const t = now + i * 0.17;
            osc.frequency.setValueAtTime(f, t);
            g.gain.setValueAtTime(0.25, t);
            g.gain.exponentialRampToValueAtTime(0.01, t + 0.16);
            osc.connect(g); g.connect(audioCtx.destination);
            osc.start(t); osc.stop(t + 0.17);
        });
    } else if (stingerType === 'laugh') {
        [580, 520, 460, 400, 340].forEach((f, i) => {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = 'square';
            const t = now + i * 0.08;
            osc.frequency.setValueAtTime(f, t);
            g.gain.setValueAtTime(0.14, t);
            g.gain.exponentialRampToValueAtTime(0.01, t + 0.07);
            osc.connect(g); g.connect(audioCtx.destination);
            osc.start(t); osc.stop(t + 0.075);
        });
    } else {
        [392, 370, 349, 311].forEach((f, i) => {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = 'triangle';
            const t = now + i * 0.14;
            osc.frequency.setValueAtTime(f, t);
            g.gain.setValueAtTime(0.22, t);
            g.gain.exponentialRampToValueAtTime(0.01, t + 0.13);
            osc.connect(g); g.connect(audioCtx.destination);
            osc.start(t); osc.stop(t + 0.14);
        });
    }
}

const customSlots = {
    kill: localStorage.getItem('royal_custom_kill') || null,
    six: localStorage.getItem('royal_custom_six') || null
};

let mediaRec = null;
let recChunks = [];
function recordCustom(slot) {
    const btn = document.getElementById('rec-' + slot);
    if (mediaRec && mediaRec.state === 'recording') {
        mediaRec.stop();
        return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        recChunks = [];
        mediaRec = new MediaRecorder(stream);
        mediaRec.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
        mediaRec.onstop = () => {
            const blob = new Blob(recChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => {
                customSlots[slot] = reader.result;
                try { localStorage.setItem('royal_custom_' + slot, reader.result); } catch(e){}
                document.getElementById('lbl-' + slot).innerText = 'Custom Mic Saved!';
                btn.classList.remove('rec');
                btn.innerText = '🎙️ Rec';
                new Audio(customSlots[slot]).play();
            };
            reader.readAsDataURL(blob);
            stream.getTracks().forEach(t => t.stop());
        };
        mediaRec.start();
        btn.classList.add('rec');
        btn.innerText = '⏹️ Stop';
        setTimeout(() => { if (mediaRec && mediaRec.state === 'recording') mediaRec.stop(); }, 4000);
    }).catch(() => alert('Mic permission allow koro othoba MP3 upload koro!'));
}

function uploadMP3(ev, slot) {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        customSlots[slot] = e.target.result;
        try { localStorage.setItem('royal_custom_' + slot, e.target.result); } catch(err){}
        document.getElementById('lbl-' + slot).innerText = file.name.slice(0, 14);
        new Audio(customSlots[slot]).play();
    };
    reader.readAsDataURL(file);
}

function playViralMemePack(memeKey, speakerPlayerIdx = 0, isOpponent = false) {
    const meme = VIRAL_MEMES[memeKey] || VIRAL_MEMES.kill1;

    const popup = document.getElementById('memePopup');
    popup.innerText = meme.banner;
    popup.classList.add('show');
    clearTimeout(window.popupTimer);
    window.popupTimer = setTimeout(() => popup.classList.remove('show'), 2200);

    const bubble = document.getElementById('bubble-' + speakerPlayerIdx);
    if (bubble) {
        bubble.innerText = meme.banner;
        bubble.classList.add('pop');
        clearTimeout(bubble.timer);
        bubble.timer = setTimeout(() => bubble.classList.remove('pop'), 2400);
    }

    spawnEmojiBurst(meme.emojis);

    const masterOn = document.getElementById('chkMaster').checked;
    const memeOn = document.getElementById('chkMeme').checked;
    const muteOpp = document.getElementById('chkMuteOpp').checked;
    if (!masterOn || !memeOn) return;
    if (isOpponent && muteOpp) return;

    if (memeKey.startsWith('kill') && customSlots.kill) {
        playViralStinger('vineboom');
        new Audio(customSlots.kill).play().catch(()=>{});
        return;
    }
    if (memeKey.startsWith('six') && customSlots.six) {
        playViralStinger('airhorn');
        new Audio(customSlots.six).play().catch(()=>{});
        return;
    }

    playViralStinger(meme.stinger);

    try {
        if (currentVoiceAudio) {
            currentVoiceAudio.pause();
            currentVoiceAudio = null;
        }
        const audio = new Audio('/api/voice?text=' + encodeURIComponent(meme.speech));
        currentVoiceAudio = audio;

        if (voiceFilterMode === 'funny') {
            audio.preservesPitch = false;
            audio.mozPreservesPitch = false;
            audio.webkitPreservesPitch = false;
            audio.playbackRate = 1.32;
        } else if (voiceFilterMode === 'bass') {
            audio.preservesPitch = false;
            audio.playbackRate = 0.92;
        } else {
            audio.playbackRate = 1.12;
        }

        audio.play().catch(() => {});
    } catch (e) {}
}

function triggerViralMeme(key) {
    if (isPaused || isGameOver) return;
    const curP = activePlayers[turnIndex];
    playViralMemePack(key, curP, false);
    if (gameMode === 'ONLINE' && currentRoomCode) {
        socket.emit('sendTaunt', { roomCode: currentRoomCode, key, speaker: localPlayerIndex });
    }
}

const canvas = document.getElementById('ludoCanvas');
const ctx = canvas.getContext('2d');
const TILE = 40;

const PALETTE = [
    { main: '#dc2626', dark: '#7f1d1d', light: '#fca5a5', glow: 'rgba(220,38,38,0.45)', name: 'RED' },
    { main: '#16a34a', dark: '#14532d', light: '#86efac', glow: 'rgba(22,163,74,0.45)', name: 'GREEN' },
    { main: '#ca8a04', dark: '#713f12', light: '#fde047', glow: 'rgba(234,179,8,0.45)', name: 'YELLOW' },
    { main: '#2563eb', dark: '#1e3a8a', light: '#93c5fd', glow: 'rgba(37,99,235,0.45)', name: 'BLUE' }
];

const MAIN_PATH = [
    [6,1],[6,2],[6,3],[6,4],[6,5],
    [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
    [0,7],
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],
    [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
    [7,14],
    [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],
    [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
    [14,7],
    [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],
    [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
    [7,0],[6,0]
];

const START_OFFSETS = [0, 13, 26, 39];
const SAFE_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const HOME_PATHS = [
    [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
    [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
    [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
    [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]]
];

const BASE_SPOTS = [
    [[1.75,1.75],[1.75,3.25],[3.25,1.75],[3.25,3.25]],
    [[1.75,10.75],[1.75,12.25],[3.25,10.75],[3.25,12.25]],
    [[10.75,10.75],[10.75,12.25],[12.25,10.75],[12.25,12.25]],
    [[10.75,1.75],[10.75,3.25],[12.25,1.75],[12.25,3.25]]
];

let gameMode = 'BOT'; // 'BOT', 'PASS', 'TEAM', 'ONLINE'
let activePlayers = [0, 2];
let turnIndex = 0;
let currentDice = 6;
let waitingForMove = false;
let isAnimating = false;
let sixCount = 0;
let turnTimerPct = 100;
let hoveredPawn = null;

// Pause & Match Completion States
let isPaused = false;
let isGameOver = false;
let finishedOrder = []; // Stores player indices in the order they finish all 4 tokens

let tokens = [];
let particles = [];
let shockwaves = [];
let floatingEmojis = [];

// Team Helper: Team A = Red(0) & Yellow(2), Team B = Green(1) & Blue(3)
function areTeammates(p1, p2) {
    if (gameMode !== 'TEAM') return false;
    return (p1 % 2) === (p2 % 2);
}

function isPlayerFinished(pIdx) {
    return tokens.filter(t => t.player === pIdx && t.step === 56).length === 4;
}

function initTokens() {
    tokens = [];
    for (let p = 0; p < 4; p++) {
        for (let id = 0; id < 4; id++) {
            const [r, c] = BASE_SPOTS[p][id];
            tokens.push({
                player: p,
                id,
                step: -1,
                visR: r,
                visC: c,
                jumpH: 0,
                scaleX: 1,
                scaleY: 1,
                rotAngle: 0
            });
        }
    }
    turnIndex = 0;
    waitingForMove = false;
    isAnimating = false;
    sixCount = 0;
    turnTimerPct = 100;
    hoveredPawn = null;
    isPaused = false;
    isGameOver = false;
    finishedOrder = [];

    document.getElementById('pauseOverlay').classList.remove('show');
    document.getElementById('gameOverOverlay').classList.remove('show');
    document.getElementById('pauseBtn').innerText = '⏸️ PAUSE (P)';
    document.getElementById('sidePauseBtn').innerText = '⏸️ Pause Match';

    set3DCubeRotation(6);
    refreshHUD();
}

// Toggle Pause / Resume
function togglePauseGame(fromNet = false) {
    if (isGameOver) return;
    isPaused = !isPaused;
    document.getElementById('pauseOverlay').classList.toggle('show', isPaused);
    document.getElementById('pauseBtn').innerText = isPaused ? '▶️ RESUME (P)' : '⏸️ PAUSE (P)';
    document.getElementById('sidePauseBtn').innerText = isPaused ? '▶️ Resume Match' : '⏸️ Pause Match';

    if (!fromNet && gameMode === 'ONLINE' && currentRoomCode) {
        socket.emit('onlinePause', { roomCode: currentRoomCode, isPaused });
    }

    refreshHUD();

    // If unpaused during Bot's turn, resume Bot action
    if (!isPaused && gameMode === 'BOT' && activePlayers[turnIndex] !== 0 && !isAnimating) {
        if (!waitingForMove) {
            setTimeout(() => { if (!isPaused && !isGameOver) runDiceAnimation(Math.floor(Math.random() * 6) + 1); }, 500);
        }
    }
}

// Start a Fresh New Match
function startNewMatch(fromNet = false) {
    if (!fromNet && gameMode === 'ONLINE' && currentRoomCode) {
        socket.emit('onlineNewMatch', { roomCode: currentRoomCode });
    }
    initTokens();
}

function getStepRC(player, step, id = 0) {
    if (step === -1) return BASE_SPOTS[player][id];
    if (step <= 50) {
        const idx = (START_OFFSETS[player] + step) % 52;
        return MAIN_PATH[idx];
    }
    return HOME_PATHS[player][Math.min(5, step - 51)];
}

function getLogicalRC(tk) {
    return getStepRC(tk.player, tk.step, tk.id);
}

function drawBeveledTile(r, c, fillStyle, isRecessed = false) {
    const x = c * TILE;
    const y = r * TILE;
    ctx.fillStyle = fillStyle;
    ctx.fillRect(x, y, TILE, TILE);

    ctx.strokeStyle = isRecessed ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 1, y + TILE - 1);
    ctx.lineTo(x + 1, y + 1);
    ctx.lineTo(x + TILE - 1, y + 1);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(120, 53, 15, 0.35)';
    ctx.beginPath();
    ctx.moveTo(x + TILE - 1, y + 1);
    ctx.lineTo(x + TILE - 1, y + TILE - 1);
    ctx.lineTo(x + 1, y + TILE - 1);
    ctx.stroke();
}

function drawRealistic3DPawn(x, y, pal, tk, isSelectable, pulse, stackCount) {
    ctx.save();
    const jumpH = tk.jumpH || 0;

    const shadowOffset = 4 + jumpH * 0.28;
    const shadowScale = Math.max(0.4, 1 - jumpH * 0.014);
    ctx.beginPath();
    ctx.ellipse(x + shadowOffset * 0.65, y + 7 + shadowOffset * 0.35, 13 * shadowScale, 6.5 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
    ctx.fill();

    if (isSelectable) {
        const rad = 17 + Math.sin(pulse * 7) * 3.5;
        ctx.beginPath();
        ctx.arc(x, y + 3, rad, 0, Math.PI * 2);
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3.5;
        ctx.stroke();
    }

    const py = y - jumpH;
    ctx.translate(x, py);
    if (tk.rotAngle) ctx.rotate(tk.rotAngle);
    ctx.scale(tk.scaleX || 1, tk.scaleY || 1);

    const baseGrad = ctx.createLinearGradient(-12, 0, 12, 0);
    baseGrad.addColorStop(0, '#92400e');
    baseGrad.addColorStop(0.5, '#fef08a');
    baseGrad.addColorStop(1, '#78350f');
    ctx.beginPath();
    ctx.ellipse(0, 5, 12, 5.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = baseGrad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#451a03';
    ctx.stroke();

    const bodyGrad = ctx.createLinearGradient(-10, -15, 10, 5);
    bodyGrad.addColorStop(0, pal.light);
    bodyGrad.addColorStop(0.45, pal.main);
    bodyGrad.addColorStop(1, pal.dark);

    ctx.beginPath();
    ctx.moveTo(-9.8, 4);
    ctx.quadraticCurveTo(-6, -8, -4.2, -12.5);
    ctx.lineTo(4.2, -12.5);
    ctx.quadraticCurveTo(6, -8, 9.8, 4);
    ctx.closePath();
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-4.5, 2);
    ctx.quadraticCurveTo(-3, -6, -2, -11);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(0, -12, 5.5, 2.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fde047';
    ctx.fill();
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1;
    ctx.stroke();

    const headGrad = ctx.createRadialGradient(-3.2, -19.5, 1.2, 0, -16.5, 8.8);
    headGrad.addColorStop(0, '#ffffff');
    headGrad.addColorStop(0.3, pal.light);
    headGrad.addColorStop(0.75, pal.main);
    headGrad.addColorStop(1, pal.dark);

    ctx.beginPath();
    ctx.arc(0, -16.5, 7.8, 0, Math.PI * 2);
    ctx.fillStyle = headGrad;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-2.8, -19.2, 2.1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();

    if (stackCount > 1) {
        ctx.fillStyle = '#090414';
        ctx.beginPath();
        ctx.arc(10, -22, 8.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('x' + stackCount, 10, -22);
    }

    ctx.restore();
}

function renderGameCanvas(ts) {
    const pulse = (ts || 0) * 0.001;
    ctx.clearRect(0, 0, 600, 600);

    for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
            const shade = (r + c) % 2 === 0 ? '#fdfbf7' : '#f5efe6';
            drawBeveledTile(r, c, shade);
        }
    }

    HOME_PATHS.forEach((path, pIdx) => {
        for (let i = 0; i < 5; i++) {
            const [r, c] = path[i];
            drawBeveledTile(r, c, PALETTE[pIdx].main, true);
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
            ctx.fillRect(c * TILE + 6, r * TILE + 6, TILE - 12, TILE - 12);
        }
    });

    const entryArrows = [[7,0,'▶',0], [0,7,'▼',1], [7,14,'◀',2], [14,7,'▲',3]];
    entryArrows.forEach(([r, c, sym, pIdx]) => {
        ctx.fillStyle = PALETTE[pIdx].main;
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sym, c * TILE + TILE / 2, r * TILE + TILE / 2);
    });

    SAFE_INDICES.forEach(idx => {
        const [r, c] = MAIN_PATH[idx];
        const starter = START_OFFSETS.indexOf(idx);
        drawBeveledTile(r, c, starter !== -1 ? PALETTE[starter].main : '#e2e8f0', true);

        const cx = c * TILE + TILE / 2;
        const cy = r * TILE + TILE / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.fillStyle = starter !== -1 ? 'rgba(0,0,0,0.22)' : 'rgba(15,23,42,0.12)';
        ctx.fill();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = starter !== -1 ? '#fde047' : '#b45309';
        ctx.font = 'bold 19px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', cx, cy + 1);
    });

    [[0,0,0], [0,9,1], [9,9,2], [9,0,3]].forEach(([r, c, pIdx]) => {
        const pal = PALETTE[pIdx];
        const g = ctx.createLinearGradient(c * TILE, r * TILE, (c + 6) * TILE, (r + 6) * TILE);
        g.addColorStop(0, pal.main);
        g.addColorStop(1, pal.dark);
        ctx.fillStyle = g;
        ctx.fillRect(c * TILE, r * TILE, 6 * TILE, 6 * TILE);

        ctx.fillStyle = '#faf5eb';
        ctx.fillRect((c + 0.85) * TILE, (r + 0.85) * TILE, 4.3 * TILE, 4.3 * TILE);
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 3.5;
        ctx.strokeRect((c + 0.85) * TILE, (r + 0.85) * TILE, 4.3 * TILE, 4.3 * TILE);

        BASE_SPOTS[pIdx].forEach(([sr, sc]) => {
            const sx = (sc + 0.5) * TILE;
            const sy = (sr + 0.5) * TILE;
            const radGrad = ctx.createRadialGradient(sx - 3, sy - 3, 2, sx, sy, 16);
            radGrad.addColorStop(0, pal.light);
            radGrad.addColorStop(0.7, pal.main);
            radGrad.addColorStop(1, pal.dark);

            ctx.beginPath();
            ctx.arc(sx, sy, 16, 0, Math.PI * 2);
            ctx.fillStyle = radGrad;
            ctx.fill();
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = '#fbbf24';
            ctx.stroke();
        });
    });

    const cx = 7.5 * TILE, cy = 7.5 * TILE;
    [
        [[6*TILE,6*TILE],[6*TILE,9*TILE],[cx,cy], 0],
        [[6*TILE,6*TILE],[9*TILE,6*TILE],[cx,cy], 1],
        [[9*TILE,6*TILE],[9*TILE,9*TILE],[cx,cy], 2],
        [[6*TILE,9*TILE],[9*TILE,9*TILE],[cx,cy], 3]
    ].forEach(([p1, p2, p3, idx]) => {
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]);
        ctx.closePath();
        ctx.fillStyle = PALETTE[idx].main;
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#fbbf24';
        ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(9, 4, 20, 0.78)';
    ctx.fill();
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👑', cx, cy + 1);

    if (!isPaused && !isGameOver && waitingForMove && hoveredPawn && canPawnMove(hoveredPawn, currentDice)) {
        drawMoveTrajectoryPreview(hoveredPawn, currentDice, pulse);
    }

    for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];
        sw.r += sw.speed || 3.5;
        sw.alpha -= 0.04;
        if (sw.alpha <= 0) { shockwaves.splice(i, 1); continue; }
        ctx.save();
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
        ctx.strokeStyle = sw.color;
        ctx.globalAlpha = sw.alpha;
        ctx.lineWidth = sw.lw || 3.5;
        ctx.stroke();
        ctx.restore();
    }

    const curP = activePlayers[turnIndex];
    const visTokens = tokens.filter(t => activePlayers.includes(t.player));
    visTokens.sort((a, b) => a.visR - b.visR);

    visTokens.forEach(tk => {
        const group = visTokens.filter(o => o.player === tk.player && o.step === tk.step && o.step !== -1 && Math.abs(o.visR - tk.visR) < 0.1);
        const idx = group.indexOf(tk);
        const offset = group.length > 1 ? (idx - (group.length - 1) / 2) * 6 : 0;

        const x = (tk.visC + 0.5) * TILE + offset;
        const y = (tk.visR + 0.5) * TILE;
        const selectable = !isPaused && !isGameOver && waitingForMove && tk.player === curP && canPawnMove(tk, currentDice);
        const badgeCount = (group.length > 1 && idx === group.length - 1) ? group.length : 1;

        drawRealistic3DPawn(x, y, PALETTE[tk.player], tk, selectable, pulse, badgeCount);
    });

    for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.25; pt.life -= 0.024;
        if (pt.life <= 0) { particles.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = pt.life;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    for (let i = floatingEmojis.length - 1; i >= 0; i--) {
        const fe = floatingEmojis[i];
        fe.y -= 2.3; fe.life -= 0.018;
        if (fe.life <= 0) { floatingEmojis.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = Math.min(1, fe.life * 1.5);
        ctx.font = '34px sans-serif';
        ctx.fillText(fe.ch, fe.x, fe.y);
        ctx.restore();
    }

    const vig = ctx.createRadialGradient(300, 300, 180, 300, 300, 430);
    vig.addColorStop(0, 'rgba(255,255,255,0.04)');
    vig.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, 600, 600);

    requestAnimationFrame(renderGameCanvas);
}

function drawMoveTrajectoryPreview(tk, dice, pulse) {
    ctx.save();
    const stepsToPreview = [];
    if (tk.step === -1 && dice === 6) {
        stepsToPreview.push(0);
    } else {
        for (let s = 1; s <= dice; s++) stepsToPreview.push(tk.step + s);
    }

    stepsToPreview.forEach((st, idx) => {
        const [r, c] = getStepRC(tk.player, st, tk.id);
        const cx = (c + 0.5) * TILE;
        const cy = (r + 0.5) * TILE;
        const isFinal = (idx === stepsToPreview.length - 1);

        ctx.beginPath();
        ctx.arc(cx, cy, isFinal ? 15 + Math.sin(pulse * 10) * 2.5 : 6, 0, Math.PI * 2);
        if (isFinal) {
            ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#fde047';
            ctx.stroke();

            if (st >= 0 && st <= 50) {
                const gIdx = (START_OFFSETS[tk.player] + st) % 52;
                if (!SAFE_INDICES.has(gIdx)) {
                    const hasVictim = tokens.some(o => o.player !== tk.player && !areTeammates(o.player, tk.player) && o.step >= 0 && o.step <= 50 && ((START_OFFSETS[o.player] + o.step) % 52) === gIdx);
                    if (hasVictim) {
                        ctx.fillStyle = '#dc2626';
                        ctx.font = 'bold 12px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('🎯 KILL!', cx, cy - 22);
                    }
                }
            }
        } else {
            ctx.fillStyle = 'rgba(250, 204, 21, 0.75)';
            ctx.fill();
        }
    });
    ctx.restore();
}

function triggerKillFX(x, y, color) {
    shockwaves.push({ x, y, r: 8, alpha: 1.0, color: '#fde047', speed: 4.2, lw: 4.5 });
    for (let i = 0; i < 42; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 2 + Math.random() * 7.5;
        particles.push({
            x, y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s - 3,
            size: 3 + Math.random() * 4.5,
            color: i % 2 === 0 ? color : '#fde047',
            life: 1.0
        });
    }
    const casing = document.getElementById('boardCasing');
    const flash = document.getElementById('killFlash');
    casing.classList.remove('shake');
    void casing.offsetWidth;
    casing.classList.add('shake');
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 350);
}

function spawnEmojiBurst(str) {
    const arr = Array.from(str || '🔥');
    for (let i = 0; i < 6; i++) {
        floatingEmojis.push({
            x: 110 + Math.random() * 380,
            y: 490 + Math.random() * 60,
            ch: arr[i % arr.length],
            life: 1.0
        });
    }
}

const CUBE_FACE_ROTATIONS = {
    1: { x: 0,   y: 0 },
    2: { x: 0,   y: -180 },
    3: { x: 0,   y: -90 },
    4: { x: 0,   y: 90 },
    5: { x: -90, y: 0 },
    6: { x: 90,  y: 0 }
};

let spinCountX = 0;
let spinCountY = 0;

function set3DCubeRotation(val, tumble = false) {
    const cube = document.getElementById('cube3D');
    if (!cube) return;
    if (tumble) {
        spinCountX += 2;
        spinCountY += 2;
    }
    const target = CUBE_FACE_ROTATIONS[val] || CUBE_FACE_ROTATIONS[1];
    const rx = target.x + spinCountX * 360;
    const ry = target.y + spinCountY * 360;
    cube.style.transform = 'translateZ(-34px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)';
}

function canPawnMove(tk, dice) {
    if (tk.step === 56) return false;
    if (tk.step === -1) return dice === 6;
    return (tk.step + dice) <= 56;
}

function isMyTurn() {
    if (isPaused || isGameOver) return false;
    const curP = activePlayers[turnIndex];
    if (gameMode === 'BOT') return curP === 0;
    if (gameMode === 'ONLINE') return curP === localPlayerIndex;
    return true;
}

function triggerRoll() {
    if (isPaused || isGameOver || waitingForMove || isAnimating || !isMyTurn()) return;
    if (gameMode === 'ONLINE') {
        socket.emit('onlineRoll', { roomCode: currentRoomCode, playerIndex: localPlayerIndex });
    } else {
        const val = Math.floor(Math.random() * 6) + 1;
        runDiceAnimation(val);
    }
}

function runDiceAnimation(finalVal) {
    if (isPaused || isGameOver) return;
    isAnimating = true;
    hoveredPawn = null;
    playRealisticFoley('dice_tumble');
    set3DCubeRotation(finalVal, true);

    setTimeout(() => {
        isAnimating = false;
        if (!isPaused && !isGameOver) handleDiceOutcome(finalVal);
    }, 560);
}

function pickRandomKey(keys) {
    return keys[Math.floor(Math.random() * keys.length)];
}

function handleDiceOutcome(val) {
    if (isPaused || isGameOver) return;
    currentDice = val;
    const curP = activePlayers[turnIndex];
    const isOpp = !isMyTurn();

    if (val === 6) {
        sixCount++;
        if (sixCount >= 3) {
            playViralMemePack('pen1', curP, isOpp);
            sixCount = 0;
            setTimeout(() => nextPlayerTurn(), 1100);
            return;
        }
        playViralMemePack(pickRandomKey(['six1', 'six2']), curP, isOpp);
    } else {
        sixCount = 0;
        if (val === 1) {
            playViralMemePack(pickRandomKey(['one1', 'one2']), curP, isOpp);
        }
    }

    const movables = tokens.filter(t => t.player === curP && canPawnMove(t, val));
    if (movables.length === 0) {
        setTimeout(() => nextPlayerTurn(), 850);
        return;
    }

    waitingForMove = true;

    if (gameMode === 'BOT' && curP !== 0) {
        setTimeout(() => {
            if (isPaused || isGameOver) return;
            let chosen = movables[0];
            for (const m of movables) {
                if (m.step >= 0 && (m.step + val) <= 50) {
                    const gIdx = (START_OFFSETS[m.player] + m.step + val) % 52;
                    const kills = tokens.some(o => o.player !== m.player && !areTeammates(o.player, m.player) && o.step >= 0 && o.step <= 50 && ((START_OFFSETS[o.player] + o.step) % 52) === gIdx);
                    if (kills) { chosen = m; break; }
                }
                if (m.step === -1 && val === 6) chosen = m;
            }
            movePawnAnimated(chosen, val);
        }, 550);
    } else if (movables.length === 1 && isMyTurn()) {
        setTimeout(() => { if (!isPaused && !isGameOver) movePawnAnimated(movables[0], val); }, 250);
    }
}

function movePawnAnimated(tk, steps) {
    if (isPaused || isGameOver) return;
    waitingForMove = false;
    hoveredPawn = null;
    isAnimating = true;
    const isOpp = !isMyTurn();

    if (tk.step === -1 && steps === 6) {
        tk.step = 0;
        const [tr, tc] = getLogicalRC(tk);
        hopTileRealistic(tk, tr, tc, () => evaluatePostMove(tk, steps, isOpp));
        return;
    }

    let rem = steps;
    function stepNext() {
        if (rem <= 0) {
            evaluatePostMove(tk, steps, isOpp);
            return;
        }
        tk.step++;
        rem--;
        const [tr, tc] = getLogicalRC(tk);
        hopTileRealistic(tk, tr, tc, stepNext);
    }
    stepNext();
}

function hopTileRealistic(tk, tr, tc, cb) {
    const sr = tk.visR, sc = tk.visC;
    const dur = 165;
    const t0 = performance.now();

    function frame(now) {
        const p = Math.min(1, (now - t0) / dur);
        tk.visR = sr + (tr - sr) * p;
        tk.visC = sc + (tc - sc) * p;
        tk.jumpH = Math.sin(p * Math.PI) * 21;

        if (p < 0.2) {
            tk.scaleX = 1.15; tk.scaleY = 0.85;
        } else if (p < 0.8) {
            tk.scaleX = 0.92; tk.scaleY = 1.12;
        } else {
            tk.scaleX = 1.18; tk.scaleY = 0.82;
        }

        if (p < 1) {
            requestAnimationFrame(frame);
        } else {
            tk.visR = tr; tk.visC = tc; tk.jumpH = 0;
            tk.scaleX = 1; tk.scaleY = 1;
            playRealisticFoley('wood_step');
            shockwaves.push({
                x: (tc + 0.5) * TILE,
                y: (tr + 0.5) * TILE + 4,
                r: 4,
                alpha: 0.45,
                color: '#d97706',
                speed: 1.5,
                lw: 2
            });
            cb();
        }
    }
    requestAnimationFrame(frame);
}

function animateKilledPawnKnockback(victimTk) {
    const sr = victimTk.visR, sc = victimTk.visC;
    const [br, bc] = BASE_SPOTS[victimTk.player][victimTk.id];
    victimTk.step = -1;
    const dur = 520;
    const t0 = performance.now();

    function knockFrame(now) {
        const p = Math.min(1, (now - t0) / dur);
        victimTk.visR = sr + (br - sr) * p;
        victimTk.visC = sc + (bc - sc) * p;
        victimTk.jumpH = Math.sin(p * Math.PI) * 75;
        victimTk.rotAngle = p * Math.PI * 4;
        if (p < 1) {
            requestAnimationFrame(knockFrame);
        } else {
            victimTk.visR = br;
            victimTk.visC = bc;
            victimTk.jumpH = 0;
            victimTk.rotAngle = 0;
            playRealisticFoley('wood_step');
        }
    }
    requestAnimationFrame(knockFrame);
}

// Check Solo & Team Match Completion Rules
function checkMatchFinishConditions(lastPlayer) {
    // Record player if they just finished all 4 tokens
    if (isPlayerFinished(lastPlayer) && !finishedOrder.includes(lastPlayer)) {
        finishedOrder.push(lastPlayer);
    }

    // 1. TEAM MODE RULE: Team A = Red(0)+Yellow(2), Team B = Green(1)+Blue(3)
    if (gameMode === 'TEAM') {
        const teamAWon = isPlayerFinished(0) && isPlayerFinished(2);
        const teamBWon = isPlayerFinished(1) && isPlayerFinished(3);

        if (teamAWon || teamBWon) {
            isGameOver = true;
            const winTeamName = teamAWon ? '🏆 TEAM A (RED & YELLOW) WINS!' : '🏆 TEAM B (GREEN & BLUE) WINS!';
            const loseTeamName = teamAWon ? '💀 Team B (Green & Blue)' : '💀 Team A (Red & Yellow)';
            showVictoryModal(winTeamName, 'টিমের ২ জন প্লেয়ারই সব গুটি ঘরে তুলে বাজিমাত করেছে!', [
                { label: '🥇 WINNER TEAM', name: teamAWon ? 'RED & YELLOW' : 'GREEN & BLUE' },
                { label: '🤡 DEFEATED TEAM', name: loseTeamName }
            ]);
            return true;
        }
        return false;
    }

    // 2. SOLO MODE RULE: Finish when (activePlayers.length - 1) players have finished!
    if (finishedOrder.length >= activePlayers.length - 1) {
        isGameOver = true;
        const remainingLoser = activePlayers.find(p => !finishedOrder.includes(p));
        const medals = ['🥇 1ST PLACE', '🥈 2ND PLACE', '🥉 3RD PLACE'];
        const rows = finishedOrder.map((pIdx, idx) => ({
            label: medals[idx] || ('RANK #' + (idx + 1)),
            name: PALETTE[pIdx].name + ' KING'
        }));
        if (remainingLoser !== undefined) {
            rows.push({
                label: '🤡 LAST / LOSER',
                name: PALETTE[remainingLoser].name + ' (হোগা মারা সারা!)'
            });
        }
        const winnerName = PALETTE[finishedOrder[0]].name;
        showVictoryModal('👑 ' + winnerName + ' WINS THE MATCH!', 'শেষ প্লেয়ার বাদে বাকি সবাই জিতে যাওয়ায় খেলা সমাপ্ত!', rows);
        return true;
    }

    return false;
}

function showVictoryModal(title, subtitle, podiumRows) {
    document.getElementById('winTitle').innerText = title;
    document.getElementById('winSubtitle').innerText = subtitle;
    const list = document.getElementById('podiumList');
    list.innerHTML = podiumRows.map(r =>
        '<div class="podium-item"><span>' + r.label + '</span><span style="color:#fde047;">' + r.name + '</span></div>'
    ).join('');
    document.getElementById('gameOverOverlay').classList.add('show');
    refreshHUD();
}

function evaluatePostMove(tk, steps, isOpp) {
    isAnimating = false;
    let bonus = (steps === 6);

    if (tk.step >= 0 && tk.step <= 50) {
        const gIdx = (START_OFFSETS[tk.player] + tk.step) % 52;
        if (!SAFE_INDICES.has(gIdx)) {
            tokens.forEach(other => {
                // In Team mode, teammates don't kill each other!
                if (other.player !== tk.player && !areTeammates(other.player, tk.player) && other.step >= 0 && other.step <= 50) {
                    const ogIdx = (START_OFFSETS[other.player] + other.step) % 52;
                    if (ogIdx === gIdx) {
                        const kx = (tk.visC + 0.5) * TILE;
                        const ky = (tk.visR + 0.5) * TILE;
                        triggerKillFX(kx, ky, PALETTE[other.player].main);
                        playViralMemePack(pickRandomKey(['kill1', 'kill2', 'kill3']), tk.player, isOpp);
                        animateKilledPawnKnockback(other);
                        bonus = true;
                    }
                }
            });
        }
    }

    if (tk.step === 56) {
        bonus = true;
        playViralMemePack('home1', tk.player, isOpp);
    }

    // Check if Solo or Team Match is Finished!
    if (checkMatchFinishConditions(tk.player)) {
        return;
    }

    refreshHUD();

    // If current player just finished all 4 tokens, pass turn to next unfinished player
    if (isPlayerFinished(tk.player)) {
        nextPlayerTurn();
        return;
    }

    if (bonus) {
        turnTimerPct = 100;
        if (gameMode === 'BOT' && activePlayers[turnIndex] !== 0) {
            setTimeout(() => { if (!isPaused && !isGameOver) runDiceAnimation(Math.floor(Math.random() * 6) + 1); }, 750);
        }
    } else {
        nextPlayerTurn();
    }
}

function nextPlayerTurn() {
    if (isGameOver) return;
    sixCount = 0;
    turnTimerPct = 100;

    // Advance to next active player who hasn't finished all 4 tokens yet
    for (let i = 0; i < activePlayers.length; i++) {
        turnIndex = (turnIndex + 1) % activePlayers.length;
        if (!isPlayerFinished(activePlayers[turnIndex])) break;
    }

    refreshHUD();

    if (!isPaused && !isGameOver && gameMode === 'BOT' && activePlayers[turnIndex] !== 0) {
        setTimeout(() => { if (!isPaused && !isGameOver) runDiceAnimation(Math.floor(Math.random() * 6) + 1); }, 650);
    }
}

function refreshHUD() {
    const curP = activePlayers[turnIndex];
    for (let i = 0; i < 4; i++) {
        const hud = document.getElementById('hud-' + i);
        const st = document.getElementById('status-' + i);
        const sc = document.getElementById('score-' + i);
        const ttag = document.getElementById('ttag-' + i);

        const homeCount = tokens.filter(t => t.player === i && t.step === 56).length;
        const done = homeCount === 4;
        if (sc) sc.innerText = done ? '✅ FINISHED' : (homeCount + '/4 Home');
        if (ttag) ttag.style.display = gameMode === 'TEAM' ? 'inline-block' : 'none';

        hud.style.display = activePlayers.includes(i) ? 'flex' : 'none';
        hud.classList.toggle('active', !isGameOver && i === curP);
        hud.classList.toggle('finished-player', done);

        if (st) {
            if (done) {
                const rankIdx = finishedOrder.indexOf(i);
                st.innerText = '🏆 Rank #' + (rankIdx + 1) + ' Complete!';
            } else if (isPaused) {
                st.innerText = '⏸️ Game Paused';
            } else {
                st.innerText = i === curP ? '🎲 Active Turn' : 'Waiting...';
            }
        }
        if (i !== curP) {
            const tf = document.getElementById('timer-' + i);
            if (tf) tf.style.width = '0%';
        }
    }
    document.getElementById('turnIndicator').innerText = isPaused ? '⏸️ PAUSED' : (PALETTE[curP].name + "'S TURN");
    document.getElementById('rollBtn').disabled = isPaused || isGameOver || !isMyTurn() || waitingForMove;
}

setInterval(() => {
    if (isAnimating || isPaused || isGameOver) return;
    const curP = activePlayers[turnIndex];
    turnTimerPct = Math.max(0, turnTimerPct - 1.5);
    const bar = document.getElementById('timer-' + curP);
    if (bar) bar.style.width = turnTimerPct + '%';
}, 200);

canvas.addEventListener('mousemove', (e) => {
    if (isPaused || isGameOver || !waitingForMove || isAnimating || !isMyTurn()) {
        hoveredPawn = null;
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const curP = activePlayers[turnIndex];
    const movables = tokens.filter(t => t.player === curP && canPawnMove(t, currentDice));

    hoveredPawn = null;
    for (const tk of movables) {
        const tx = (tk.visC + 0.5) * TILE;
        const ty = (tk.visR + 0.5) * TILE;
        if (Math.hypot(mx - tx, my - ty) < 26) {
            hoveredPawn = tk;
            break;
        }
    }
});

canvas.addEventListener('click', (e) => {
    if (isPaused || isGameOver || !waitingForMove || isAnimating || !isMyTurn()) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);

    const curP = activePlayers[turnIndex];
    const movables = tokens.filter(t => t.player === curP && canPawnMove(t, currentDice));

    for (const tk of movables) {
        const tx = (tk.visC + 0.5) * TILE;
        const ty = (tk.visR + 0.5) * TILE;
        if (Math.hypot(mx - tx, my - ty) < 26) {
            if (gameMode === 'ONLINE') {
                socket.emit('onlineMove', { roomCode: currentRoomCode, player: tk.player, id: tk.id, steps: currentDice });
            } else {
                movePawnAnimated(tk, currentDice);
            }
            break;
        }
    }
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        triggerRoll();
    } else if (e.code === 'KeyP') {
        e.preventDefault();
        togglePauseGame();
    }
});

const socket = io();
let currentRoomCode = null;
let localPlayerIndex = 0;

function changeMode(m) {
    gameMode = m;
    document.getElementById('btnModeBot').classList.toggle('active', m === 'BOT');
    document.getElementById('btnModePass').classList.toggle('active', m === 'PASS');
    document.getElementById('btnModeTeam').classList.toggle('active', m === 'TEAM');
    document.getElementById('name-2').innerText = m === 'BOT' ? 'SAVAGE BOT' : 'YELLOW KING';

    if (m === 'BOT') {
        document.getElementById('gameModeBadge').innerText = '1V1 SAVAGE BOT';
        activePlayers = [0, 2];
    } else if (m === 'PASS') {
        document.getElementById('gameModeBadge').innerText = '4P SOLO (TOP 3 WIN)';
        activePlayers = [0, 1, 2, 3];
    } else if (m === 'TEAM') {
        document.getElementById('gameModeBadge').innerText = '2V2 TEAM BATTLE';
        activePlayers = [0, 1, 2, 3];
    }
    initTokens();
}

function createRoom() { socket.emit('createRoom'); }
function joinRoom() {
    const code = document.getElementById('roomInp').value;
    if (code) socket.emit('joinRoom', { roomCode: code });
}

socket.on('roomCreated', ({ roomCode, playerIndex }) => {
    gameMode = 'ONLINE';
    currentRoomCode = roomCode;
    localPlayerIndex = playerIndex;
    document.getElementById('gameModeBadge').innerText = 'ROOM: ' + roomCode;
    document.getElementById('roomMsg').innerText = 'Room Code: ' + roomCode + ' (অন্য ট্যাবে বা বন্ধুকে Join করতে বলো)';
});

socket.on('roomJoined', ({ roomCode, playerIndex }) => {
    gameMode = 'ONLINE';
    currentRoomCode = roomCode;
    localPlayerIndex = playerIndex;
    document.getElementById('gameModeBadge').innerText = 'ROOM: ' + roomCode;
});

socket.on('startOnlineGame', ({ roomCode }) => {
    activePlayers = [0, 2];
    initTokens();
    document.getElementById('roomMsg').innerText = 'Live Match Started in Room ' + roomCode + '!';
});

socket.on('onlineDiceRolled', ({ diceVal }) => runDiceAnimation(diceVal));
socket.on('onlineTokenMoved', ({ player, id, steps }) => {
    const tk = tokens.find(t => t.player === player && t.id === id);
    if (tk) movePawnAnimated(tk, steps);
});
socket.on('receiveTaunt', ({ key, speaker }) => {
    playViralMemePack(key, speaker || 2, true);
});
socket.on('receivePause', ({ isPaused: netPaused }) => {
    if (isPaused !== netPaused) togglePauseGame(true);
});
socket.on('receiveNewMatch', () => {
    startNewMatch(true);
});
socket.on('roomError', msg => document.getElementById('roomMsg').innerText = msg);

initTokens();
requestAnimationFrame(renderGameCanvas);
</script>
</body>
</html>`;

app.get('/', (req, res) => res.send(GAME_HTML));

// ============================================================================
// 4. CLOUD-READY SERVER LAUNCHER (WORKS ON RENDER, VERCEL, AND LOCAL MAC)
// ============================================================================
const PORT = process.env.PORT || 3000;

if (!process.env.VERCEL) {
    server.listen(PORT, () => {
        const url = 'http://localhost:' + PORT;
        console.log('====================================================');
        console.log('👑 LUDO STAR ROYAL 3D (CLOUD READY EDITION): ' + url);
        console.log('====================================================');
        // Only auto-open browser when running locally on macOS
        if (!process.env.PORT && process.platform === 'darwin') {
            exec('open ' + url);
        }
    });
}

module.exports = app;