/**
 * Path Blocker — Multiplayer Server  (with Bot support)
 * Run: node server.js
 * Requires: npm install express socket.io
 */
 
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
 
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
 
app.use(express.static(path.join(__dirname)));
 
// ─── Constants ────────────────────────────────────────────────────────────────
const COLS = 10, ROWS = 10;
 
const BOT_NAMES = [
  'Arjun', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Sneha', 'Karan', 'Divya',
  'Aditya', 'Meera', 'Rahul', 'Pooja', 'Nikhil', 'Shreya', 'Amit', 'Neha',
  'Suresh', 'Kavya', 'Ravi', 'Isha', 'Deepak', 'Simran', 'Ajay', 'Tanya',
  'Sanjay', 'Nisha', 'Manoj', 'Ritika', 'Prakash', 'Swati',
];
 
// ─── Room Management ─────────────────────────────────────────────────────────
const rooms = new Map();
let waitingRoom = null;
 
function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
 
function initState() {
  return {
    turn: 1,
    pieces: { 1: { r: 0, c: 4 }, 2: { r: 9, c: 4 } },
    goals:  { 1: 9, 2: 0 },
    walls: [],
    wallCounts: { 1: 8, 2: 8 },
    over: false,
    winner: null,
  };
}
 
// ─── Path-finding helpers ────────────────────────────────────────────────────
function blocksEdge(walls, r, c, dr, dc) {
  const nr = r + dr, nc = c + dc;
  if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return true;
  for (const w of walls) {
    if (dc === 1)  { if (w.dir === 'v' && ((w.r === r && w.c === c+1) || (w.r === r-1 && w.c === c+1))) return true; }
    if (dc === -1) { if (w.dir === 'v' && ((w.r === r && w.c === c)   || (w.r === r-1 && w.c === c)))   return true; }
    if (dr === 1)  { if (w.dir === 'h' && ((w.r === r+1 && w.c === c) || (w.r === r+1 && w.c === c-1))) return true; }
    if (dr === -1) { if (w.dir === 'h' && ((w.r === r && w.c === c)   || (w.r === r && w.c === c-1)))   return true; }
  }
  return false;
}
 
function getNeighbors(walls, r, c) {
  return [[-1,0],[1,0],[0,-1],[0,1]]
    .filter(([dr,dc]) => !blocksEdge(walls, r, c, dr, dc))
    .map(([dr,dc]) => [r+dr, c+dc]);
}
 
function bfsDist(walls, startR, startC, goalRow) {
  const visited = new Set([`${startR},${startC}`]);
  const queue = [[startR, startC, 0]];
  while (queue.length) {
    const [r, c, d] = queue.shift();
    if (r === goalRow) return d;
    for (const [nr, nc] of getNeighbors(walls, r, c)) {
      const k = `${nr},${nc}`;
      if (!visited.has(k)) { visited.add(k); queue.push([nr, nc, d+1]); }
    }
  }
  return Infinity;
}
 
function bfsNextStep(walls, startR, startC, goalRow) {
  const visited = new Set([`${startR},${startC}`]);
  const queue = [[startR, startC, null]];
  while (queue.length) {
    const [r, c, first] = queue.shift();
    if (r === goalRow) return first;
    for (const [nr, nc] of getNeighbors(walls, r, c)) {
      const k = `${nr},${nc}`;
      if (!visited.has(k)) {
        visited.add(k);
        queue.push([nr, nc, first || { r: nr, c: nc }]);
      }
    }
  }
  return null;
}
 
function hasPath(walls, startR, startC, goalRow) {
  return bfsDist(walls, startR, startC, goalRow) < Infinity;
}
 
function wallOverlaps(walls, w) {
  for (const x of walls) {
    if (x.dir !== w.dir) continue;
    if (w.dir === 'h') {
      if (w.r === x.r && (w.c === x.c || w.c === x.c + 1 || w.c + 1 === x.c)) return true;
    } else {
      if (w.c === x.c && (w.r === x.r || w.r === x.r + 1 || w.r + 1 === x.r)) return true;
    }
  }
  return false;
}
 
function isWallLegal(walls, w, pieces, goals) {
  const key = `${w.r},${w.c},${w.dir}`;
  if (walls.some(x => `${x.r},${x.c},${x.dir}` === key)) return false;
  if (wallOverlaps(walls, w)) return false;
  const newWalls = [...walls, w];
  if (!hasPath(newWalls, pieces[1].r, pieces[1].c, goals[1])) return false;
  if (!hasPath(newWalls, pieces[2].r, pieces[2].c, goals[2])) return false;
  return true;
}
 
// ─── Bot AI ──────────────────────────────────────────────────────────────────
function botTurn(st) {
  const bot = 2, human = 1;
  const botPiece   = st.pieces[bot];
  const humanPiece = st.pieces[human];
  const botDist    = bfsDist(st.walls, botPiece.r,   botPiece.c,   st.goals[bot]);
  const humanDist  = bfsDist(st.walls, humanPiece.r, humanPiece.c, st.goals[human]);
 
  const shouldWall = st.wallCounts[bot] > 0 && (humanDist <= 6 || humanDist < botDist);
  if (shouldWall) {
    const wall = findBestWall(st, human, bot);
    if (wall) {
      st.walls.push({ ...wall, owner: bot });
      st.wallCounts[bot]--;
      st.turn = human;
      return;
    }
  }
 
  const next = bfsNextStep(st.walls, botPiece.r, botPiece.c, st.goals[bot]);
  if (next) {
    st.pieces[bot] = next;
    if (next.r === st.goals[bot]) { st.over = true; st.winner = bot; return; }
  }
  st.turn = human;
}
 
function findBestWall(st, targetPlayer, wallOwner) {
  const pieces = st.pieces, goals = st.goals, walls = st.walls;
  const targetPiece = pieces[targetPlayer];
  const baseDist = bfsDist(walls, targetPiece.r, targetPiece.c, goals[targetPlayer]);
  let bestWall = null, bestGain = 0;
 
  for (let r = 1; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const w = { r, c, dir: 'h', owner: wallOwner };
      if (!isWallLegal(walls, w, pieces, goals)) continue;
      const gain = bfsDist([...walls, w], targetPiece.r, targetPiece.c, goals[targetPlayer]) - baseDist;
      if (gain > bestGain) { bestGain = gain; bestWall = w; }
    }
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS; c++) {
      const w = { r, c, dir: 'v', owner: wallOwner };
      if (!isWallLegal(walls, w, pieces, goals)) continue;
      const gain = bfsDist([...walls, w], targetPiece.r, targetPiece.c, goals[targetPlayer]) - baseDist;
      if (gain > bestGain) { bestGain = gain; bestWall = w; }
    }
  }
  return bestGain >= 1 ? bestWall : null;
}
 
function applyMove(st, player, r, c) {
  const p = st.pieces[player];
  const dr = r - p.r, dc = c - p.c;
  if (Math.abs(dr) + Math.abs(dc) !== 1) return 'Invalid move';
  if (blocksEdge(st.walls, p.r, p.c, dr, dc)) return 'Wall blocking';
  st.pieces[player] = { r, c };
  if (r === st.goals[player]) { st.over = true; st.winner = player; }
  else st.turn = player === 1 ? 2 : 1;
  return null;
}
 
function applyWall(st, player, w) {
  if (st.wallCounts[player] <= 0) return 'No walls left';
  if (!isWallLegal(st.walls, w, st.pieces, st.goals)) return 'Invalid wall placement';
  st.walls.push({ ...w, owner: player });
  st.wallCounts[player]--;
  st.turn = player === 1 ? 2 : 1;
  return null;
}
 
// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);
  let myRoom = null;
  let myPlayer = null;
 
  socket.on('join', () => {
    if (waitingRoom) {
      const room = rooms.get(waitingRoom);
      if (room.botFallbackTimer) { clearTimeout(room.botFallbackTimer); room.botFallbackTimer = null; }
      room.players[1] = socket.id;
      myRoom = waitingRoom;
      myPlayer = 2;
      waitingRoom = null;
      socket.join(myRoom);
      io.to(room.players[0]).emit('assigned', { player: 1, roomId: myRoom, vsBot: false });
      io.to(room.players[1]).emit('assigned', { player: 2, roomId: myRoom, vsBot: false });
      io.to(myRoom).emit('state', room.state);
    } else {
      const roomId = makeRoomId();
      const state = initState();
      const room = { players: [socket.id, null], state, vsBot: false, botFallbackTimer: null };
      rooms.set(roomId, room);
      socket.join(roomId);
      myRoom = roomId;
      myPlayer = 1;
      waitingRoom = roomId;
      socket.emit('waiting', { roomId });
 
      const fallbackDelay = 10000 + Math.random() * 5000;
      room.botFallbackTimer = setTimeout(() => {
        if (waitingRoom !== roomId) return;
        const r = rooms.get(roomId);
        if (!r || r.players[1]) return;
        waitingRoom = null;
        r.players[1] = 'BOT';
        r.vsBot = true;
        const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
        r.botName = botName;
        io.to(roomId).emit('assigned', { player: 1, roomId, vsBot: true, opponentName: botName });
        io.to(roomId).emit('state', r.state);
        console.log('[~] Room ' + roomId + ': no opponent found, filled with BOT');
      }, fallbackDelay);
    }
  });
 
  socket.on('joinRoom', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error', 'Room not found'); return; }
    if (room.players[1]) { socket.emit('error', 'Room full'); return; }
    room.players[1] = socket.id;
    myRoom = roomId;
    myPlayer = 2;
    if (waitingRoom === roomId) waitingRoom = null;
    socket.join(myRoom);
    io.to(room.players[0]).emit('assigned', { player: 1, roomId, vsBot: false });
    io.to(room.players[1]).emit('assigned', { player: 2, roomId, vsBot: false });
    io.to(myRoom).emit('state', room.state);
  });
 
  socket.on('joinBot', () => {
    const roomId = makeRoomId();
    const state = initState();
    const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const room = { players: [socket.id, 'BOT'], state, vsBot: true, botName };
    rooms.set(roomId, room);
    socket.join(roomId);
    myRoom = roomId;
    myPlayer = 1;
    socket.emit('assigned', { player: 1, roomId, vsBot: true, opponentName: botName });
    socket.emit('state', state);
  });
 
  socket.on('move', ({ r, c }) => {
    const room = rooms.get(myRoom);
    if (!room || room.state.over) return;
    const st = room.state;
    if (st.turn !== myPlayer) { socket.emit('error', "Not your turn"); return; }
    const err = applyMove(st, myPlayer, r, c);
    if (err) { socket.emit('error', err); return; }
    io.to(myRoom).emit('state', st);
    if (!st.over && room.vsBot && st.turn === 2) {
      setTimeout(() => {
        if (!room.state.over) { botTurn(room.state); io.to(myRoom).emit('state', room.state); }
      }, 600);
    }
  });
 
  socket.on('wall', (w) => {
    const room = rooms.get(myRoom);
    if (!room || room.state.over) return;
    const st = room.state;
    if (st.turn !== myPlayer) { socket.emit('error', "Not your turn"); return; }
    const err = applyWall(st, myPlayer, w);
    if (err) { socket.emit('error', err); return; }
    io.to(myRoom).emit('state', st);
    if (!st.over && room.vsBot && st.turn === 2) {
      setTimeout(() => {
        if (!room.state.over) { botTurn(room.state); io.to(myRoom).emit('state', room.state); }
      }, 600);
    }
  });
 
  socket.on('restart', () => {
    const room = rooms.get(myRoom);
    if (!room) return;
    room.state = initState();
    io.to(myRoom).emit('state', room.state);
  });
 
  socket.on('disconnect', () => {
    if (!myRoom) return;
    const room = rooms.get(myRoom);
    if (!room) return;
    if (waitingRoom === myRoom) waitingRoom = null;
    if (!room.vsBot) io.to(myRoom).emit('opponentLeft');
    rooms.delete(myRoom);
  });
});
 
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮  Path Blocker server running on http://localhost:${PORT}\n`);
});