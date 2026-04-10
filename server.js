const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const os = require('os');

const PORT = process.env.PORT || 3000;

// 로컬 IP 가져오기
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// HTTP 서버 (controller.html 제공)
const httpServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/controller') {
    const html = fs.readFileSync(path.join(__dirname, 'controller.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// WebSocket 서버
const wss = new WebSocketServer({ server: httpServer });

let gameClients = [];    // Unity 게임 클라이언트
let controllers = [];    // 모바일 컨트롤러

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // 클라이언트 등록
      if (msg.type === 'register') {
        if (msg.role === 'game') {
          gameClients.push(ws);
          ws.role = 'game';
          console.log(`[+] 게임 클라이언트 연결 (총 ${gameClients.length}개)`);
        } else if (msg.role === 'controller') {
          const playerId = controllers.length + 1;
          controllers.push(ws);
          ws.role = 'controller';
          ws.playerId = playerId;
          ws.send(JSON.stringify({ type: 'assigned', playerId }));
          console.log(`[+] 컨트롤러 연결 - 플레이어 ${playerId} (총 ${controllers.length}명)`);
          
          // 게임에 플레이어 입장 알림
          broadcast(gameClients, { type: 'player_joined', playerId, total: controllers.length });
        }
      }

      // 입력 중계: 컨트롤러 → 게임
      if (msg.type === 'input' && ws.role === 'controller') {
        broadcast(gameClients, {
          type: 'input',
          playerId: ws.playerId,
          ...msg.data
        });
      }

    } catch (e) {
      console.error('메시지 파싱 오류:', e.message);
    }
  });

  ws.on('close', () => {
    if (ws.role === 'game') {
      gameClients = gameClients.filter(c => c !== ws);
      console.log(`[-] 게임 클라이언트 해제`);
    } else if (ws.role === 'controller') {
      controllers = controllers.filter(c => c !== ws);
      broadcast(gameClients, { type: 'player_left', playerId: ws.playerId, total: controllers.length });
      console.log(`[-] 플레이어 ${ws.playerId} 연결 해제`);
    }
  });
});

function broadcast(clients, data) {
  const msg = JSON.stringify(data);
  clients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
}

// 서버 시작
httpServer.listen(PORT, async () => {
  const ip = getLocalIP();
  const url = process.env.PUBLIC_URL || `http://${ip}:${PORT}`;

  console.log('\n========================================');
  console.log(`  모바일 컨트롤러 서버 실행 중`);
  console.log(`  게임(Unity) 연결: ws://${ip}:${PORT}`);
  console.log(`  컨트롤러(폰) 접속: ${url}`);
  console.log('========================================\n');

  // 터미널에 QR 코드 출력
  console.log('  [폰으로 아래 QR 코드를 스캔하세요]\n');
  const qr = await QRCode.toString(url, { type: 'terminal', small: true });
  console.log(qr);
  console.log(`  URL: ${url}\n`);
});
