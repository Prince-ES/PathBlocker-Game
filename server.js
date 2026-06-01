/**
 * Path Blocker — Multiplayer Server
 * Run: node server.js
 * Requires: npm install express socket.io
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve the game HTML
app.use(express.static(path.join(__dirname)));

// ─── Game Constants ───────────────────────────────────────────────────────────
const COLS = 10, ROWS = 10;

// ─── Room Management ─────────────────────────────────────────────────────────
// rooms: Map<roomId, { players: [socketId, socketId|null], state: GameState }>
const rooms = new Map();
let waitingRoom = null; // roomId waiting for a second player

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

// ─── Path-finding helpers (mirrors client logic) ──────────────────────────────
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

function hasPath(walls, startR, startC, goalRow) {
  const visited = new Set([`${startR},${startC}`]);
  const queue = [[startR, startC]];
  while (queue.length) {
    const [r, c] = queue.shift();
    if (r === goalRow) return true;
    for (const [nr, nc] of getNeighbors(walls, r, c)) {
      const k = `${nr},${nc}`;
      if (!visited.has(k)) { visited.add(k); queue.push([nr, nc]); }
    }
  }
  return false;
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

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);
  let myRoom = null;
  let myPlayer = null;

  // ── Join matchmaking ────────────────────────────────────────────────────────
  socket.on('join', () => {
    if (waitingRoom) {
      // Second player joins existing room
      const room = rooms.get(waitingRoom);
      room.players[1] = socket.id;
      myRoom = waitingRoom;
      myPlayer = 2;
      waitingRoom = null;

      socket.join(myRoom);
      console.log(`[~] Room ${myRoom}: P1=${room.players[0]} P2=${room.players[1]}`);

      // Tell both players who they are and send initial state
      io.to(room.players[0]).emit('assigned', { player: 1, roomId: myRoom });
      io.to(room.players[1]).emit('assigned', { player: 2, roomId: myRoom });
      io.to(myRoom).emit('state', room.state);
    } else {
      // First player creates room
      const roomId = makeRoomId();
      const state = initState();
      rooms.set(roomId, { players: [socket.id, null], state });
      socket.join(roomId);
      myRoom = roomId;
      myPlayer = 1;
      waitingRoom = roomId;
      socket.emit('waiting', { roomId });
      console.log(`[+] Room ${roomId} created, waiting for P2`);
    }
  });

  // ── Join by room ID (direct link) ───────────────────────────────────────────
  socket.on('joinRoom', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error', 'Room not found'); return; }
    if (room.players[1]) { socket.emit('error', 'Room full'); return; }

    room.players[1] = socket.id;
    myRoom = roomId;
    myPlayer = 2;
    if (waitingRoom === roomId) waitingRoom = null;

    socket.join(myRoom);
    io.to(room.players[0]).emit('assigned', { player: 1, roomId });
    io.to(room.players[1]).emit('assigned', { player: 2, roomId });
    io.to(myRoom).emit('state', room.state);
  });

  // ── Move ────────────────────────────────────────────────────────────────────
  socket.on('move', ({ r, c }) => {
    const room = rooms.get(myRoom);
    if (!room || room.state.over) return;
    const st = room.state;
    if (st.turn !== myPlayer) { socket.emit('error', "Not your turn"); return; }

    const p = st.pieces[myPlayer];
    const dr = r - p.r, dc = c - p.c;
    if (Math.abs(dr) + Math.abs(dc) !== 1) { socket.emit('error', 'Invalid move'); return; }
    if (blocksEdge(st.walls, p.r, p.c, dr, dc)) { socket.emit('error', 'Wall blocking'); return; }

    st.pieces[myPlayer] = { r, c };

    if (r === st.goals[myPlayer]) {
      st.over = true;
      st.winner = myPlayer;
    } else {
      st.turn = myPlayer === 1 ? 2 : 1;
    }

    io.to(myRoom).emit('state', st);
  });

  // ── Place wall ──────────────────────────────────────────────────────────────
  socket.on('wall', (w) => {
    const room = rooms.get(myRoom);
    if (!room || room.state.over) return;
    const st = room.state;
    if (st.turn !== myPlayer) { socket.emit('error', "Not your turn"); return; }
    if (st.wallCounts[myPlayer] <= 0) { socket.emit('error', 'No walls left'); return; }

    const key = `${w.r},${w.c},${w.dir}`;
    if (st.walls.some(x => `${x.r},${x.c},${x.dir}` === key)) { socket.emit('error', 'Wall already there'); return; }
    if (wallOverlaps(st.walls, w)) { socket.emit('error', 'Overlaps existing wall'); return; }

    const newWalls = [...st.walls, { ...w, owner: myPlayer }];
    const p1 = st.pieces[1], p2 = st.pieces[2];
    if (!hasPath(newWalls, p1.r, p1.c, st.goals[1]) || !hasPath(newWalls, p2.r, p2.c, st.goals[2])) {
      socket.emit('error', "Would trap a player!"); return;
    }

    st.walls.push({ ...w, owner: myPlayer });
    st.wallCounts[myPlayer]--;
    st.turn = myPlayer === 1 ? 2 : 1;

    io.to(myRoom).emit('state', st);
  });

  // ── Restart ─────────────────────────────────────────────────────────────────
  socket.on('restart', () => {
    const room = rooms.get(myRoom);
    if (!room) return;
    room.state = initState();
    io.to(myRoom).emit('state', room.state);
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    if (!myRoom) return;
    const room = rooms.get(myRoom);
    if (!room) return;
    if (waitingRoom === myRoom) waitingRoom = null;
    io.to(myRoom).emit('opponentLeft');
    rooms.delete(myRoom);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮  Path Blocker server running on http://localhost:${PORT}\n`);
});
