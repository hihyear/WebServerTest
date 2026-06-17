const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const os = require('os');

const PORT = process.env.PORT || 3001;

// ── 게임 상태 ──────────────────────────────
let gameState = 'idle';   // 'idle' | 'playing'
let currentPlayer = null; // 현재 플레이어 WebSocket
let gameClients = [];     // Unity 게임 클라이언트 목록

// ── HTTP 서버 ──────────────────────────────
const httpServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/controller') {
    const html = fs.readFileSync(path.join(__dirname, 'controller_crane.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ── WebSocket 서버 ─────────────────────────
const wss = new WebSocketServer({ server: httpServer });

function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws) => {

  // ── 하트비트 초기화 ──
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // Unity 게임 클라이언트 등록
      if (msg.type === 'register' && msg.role === 'game') {
        gameClients.push(ws);
        ws.role = 'game';
        // 현재 게임 상태를 Unity에 알림
        ws.send(JSON.stringify({ type: 'state', state: gameState }));
        console.log(`[+] Unity 연결 (게임 클라이언트 ${gameClients.length}개)`);
      }

      // 컨트롤러 등록 요청
      if (msg.type === 'register' && msg.role === 'controller') {
        if (gameState === 'idle') {
          // 아무도 없음 → 게임 시작
          gameState = 'playing';
          currentPlayer = ws;
          ws.role = 'controller';

          ws.send(JSON.stringify({ type: 'game_start' }));
          broadcast(gameClients, { type: 'game_start' });
          console.log('[+] 플레이어 입장 → 게임 시작');

        } else {
          // 누군가 플레이 중 → 대기 안내
          ws.role = 'waiting';
          ws.send(JSON.stringify({ type: 'game_busy' }));
          console.log('[!] 접속 시도 → 이미 플레이 중');
        }
      }

      // 입력 중계 (현재 플레이어만)
      if (msg.type === 'input' && ws === currentPlayer) {
        broadcast(gameClients, {
          type: 'input',
          x:    msg.data.x    ?? 0,
          y:    msg.data.y    ?? 0,
          drop: msg.data.drop ?? false,
        });
      }

      // 게임 종료 (Unity에서 결과 처리 후 호출)
      if (msg.type === 'game_end' && ws.role === 'game') {
        endGame('game_clear');
      }

    } catch (e) {
      console.error('파싱 오류:', e.message);
    }
  });

  ws.on('close', () => {
    // Unity 연결 해제
    if (ws.role === 'game') {
      gameClients = gameClients.filter(c => c !== ws);
      console.log(`[-] Unity 해제 (남은 게임 클라이언트 ${gameClients.length}개)`);
    }

    // 플레이어 연결 해제
    if (ws === currentPlayer) {
      console.log('[-] 플레이어 퇴장 → idle 상태로 전환');
      endGame('player_left');
    }
  });
});

function endGame(reason) {
  gameState = 'idle';

  // 현재 플레이어에게 종료 알림 후 연결 강제 종료
  if (currentPlayer && currentPlayer.readyState === 1) {
    currentPlayer.send(JSON.stringify({ type: 'game_end', reason }));
    currentPlayer.close();
  }
  currentPlayer = null;

  broadcast(gameClients, { type: 'game_end', reason });
  console.log(`[게임 종료] reason: ${reason}`);
}

function broadcast(clients, data) {
  const msg = JSON.stringify(data);
  clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// ── 하트비트 체크 (5초마다) ─────────────────
// 응답 없는 연결(비정상 종료된 클라이언트)을 강제로 끊어서
// close 이벤트를 발생시키고 게임 상태를 즉시 정리한다.
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('[!] 응답 없는 연결 강제 종료');
      return ws.terminate();   // → 'close' 이벤트 발생 → 기존 정리 로직 실행
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 5000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// ── 서버 시작 ──────────────────────────────
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return 'localhost';
}

httpServer.listen(PORT, async () => {
  const ip = getLocalIP();
  const url = process.env.PUBLIC_URL || `http://${ip}:${PORT}`;

  console.log('\n========================================');
  console.log(`  크레인 게임 서버 실행 중`);
  console.log(`  Unity 연결:      ws://${ip}:${PORT}`);
  console.log(`  컨트롤러 접속:   ${url}`);
  console.log('========================================\n');

  const qr = await QRCode.toString(url, { type: 'terminal', small: true });
  console.log(qr);
  console.log(`  URL: ${url}\n`);
});
