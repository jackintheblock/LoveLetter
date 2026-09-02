const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const DEFAULT_CARD_COUNTS = {
  guard: 5, priest: 2, baron: 2, handmaid: 2, prince: 2,
  chancellor: 2, king: 1, countess: 1, princess: 1, spy: 2
};

const CARD_VALUES = {
  spy: 0, guard: 1, priest: 2, baron: 3, handmaid: 4,
  prince: 5, chancellor: 6, king: 7, countess: 8, princess: 9
};

const WIN_TOKENS_DEFAULT = 4;
const rooms = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function buildDeck(counts) {
  const deck = [];
  for (const [cardKey, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) deck.push(cardKey);
  }
  return deck.sort(() => Math.random() - 0.5);
}

function createRoom(socket, config) {
  const code = generateRoomCode();
  const room = {
    code,
    host: socket.id,
    players: [{ id: socket.id, name: config.playerName, hand: [], protected: false, eliminated: false, tokens: 0 }],
    deck: buildDeck(config.cardCounts || DEFAULT_CARD_COUNTS),
    discard: [],
    currentPlayerIndex: 0,
    turn: 1,
    lastPlayedCard: null,
    gameStarted: false,
    roundActive: false,
    pendingChancellor: null,
    config: {
      cardCounts: config.cardCounts || DEFAULT_CARD_COUNTS,
      winTokens: config.winTokens || WIN_TOKENS_DEFAULT
    }
  };
  rooms.set(code, room);
  socket.join(code);
  socket.emit('roomCreated', { code, room: sanitizeRoom(room) });
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    host: room.host,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      handSize: p.hand.length,
      protected: p.protected,
      eliminated: p.eliminated,
      tokens: p.tokens
    })),
    deckSize: room.deck.length,
    currentPlayerIndex: room.currentPlayerIndex,
    turn: room.turn,
    gameStarted: room.gameStarted,
    lastPlayedCard: room.lastPlayedCard,
    winTokens: room.config.winTokens
  };
}

function findRoomByPlayer(playerId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.id === playerId)) return room;
  }
  return null;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', (data) => createRoom(socket, data));

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) return socket.emit('error', 'Room not found');
    if (room.players.length >= 4) return socket.emit('error', 'Room full');
    if (room.gameStarted) return socket.emit('error', 'Game already started');
    room.players.push({ id: socket.id, name: playerName, hand: [], protected: false, eliminated: false, tokens: 0 });
    socket.join(room.code);
    io.to(room.code).emit('roomUpdate', sanitizeRoom(room));
    socket.emit('joinedRoom', { code: room.code });
  });

  socket.on('startGame', () => {
    const room = findRoomByPlayer(socket.id);
    if (!room || room.host !== socket.id || room.gameStarted) return;
    startNewRound(room);
  });

  socket.on('playCard', ({ cardIndex, targetId, guardGuess }) => {
    const room = findRoomByPlayer(socket.id);
    if (!room || !room.roundActive || room.pendingChancellor) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.eliminated) return;
    if (room.players[room.currentPlayerIndex].id !== socket.id) return;
    if (cardIndex < 0 || cardIndex >= player.hand.length) return;

    const cardKey = player.hand.splice(cardIndex, 1)[0];
    room.discard.push(cardKey);
    const previousCard = room.lastPlayedCard;
    room.lastPlayedCard = cardKey;
    io.to(room.code).emit('cardPlayed', { playerId: socket.id, cardKey, targetId });
    io.to(player.id).emit('yourHand', player.hand);

    const shouldAdvance = applyCardEffect(room, player, cardKey, targetId, guardGuess, previousCard);
    if (shouldAdvance) nextTurn(room);
  });

  socket.on('chancellorReturn', ({ cardIndices, order }) => {
    const room = findRoomByPlayer(socket.id);
    if (!room || !room.pendingChancellor || room.pendingChancellor.playerId !== socket.id) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const indices = cardIndices.sort((a, b) => b - a);
    if (indices.length !== 2 || indices.some(i => i < 0 || i >= player.hand.length)) return;

    const returnedCards = indices.map(i => player.hand.splice(i, 1)[0]);
    room.pendingChancellor = null;

    const finalOrder = order && order.length === 2 ? order : returnedCards;
    // Push in reverse so first element of finalOrder is on top (drawn first)
    room.deck.push(finalOrder[1], finalOrder[0]);

    io.to(player.id).emit('yourHand', player.hand);
    nextTurn(room);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const [code, room] of rooms) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(code);
        } else {
          if (room.host === socket.id) room.host = room.players[0].id;
          if (room.currentPlayerIndex >= room.players.length) room.currentPlayerIndex = 0;
          io.to(code).emit('roomUpdate', sanitizeRoom(room));
        }
      }
    }
  });
});

function startNewRound(room) {
  room.deck = buildDeck(room.config.cardCounts);
  room.discard = [];
  room.currentPlayerIndex = 0;
  room.turn = 1;
  room.lastPlayedCard = null;
  room.pendingChancellor = null;
  for (const p of room.players) {
    p.hand = [];
    p.protected = false;
    p.eliminated = false;
  }
  for (const p of room.players) {
    p.hand.push(room.deck.pop());
  }
  // Draw second card for first player
  room.players[0].hand.push(room.deck.pop());

  room.gameStarted = true;
  room.roundActive = true;
  io.to(room.code).emit('gameStarted', sanitizeRoom(room));
  room.players.forEach(p => io.to(p.id).emit('yourHand', p.hand));
  emitTurnUpdate(room);
}

function emitTurnUpdate(room) {
  const current = room.players[room.currentPlayerIndex];
  io.to(room.code).emit('turnUpdate', {
    currentPlayerId: current.id,
    turn: room.turn,
    deckSize: room.deck.length,
    lastPlayedCard: room.lastPlayedCard
  });
}

function nextTurn(room) {
  const activePlayers = room.players.filter(p => !p.eliminated);
  if (activePlayers.length === 1) {
    endRound(room, activePlayers[0]);
    return;
  }
  if (room.deck.length === 0) {
    let winner = activePlayers[0];
    for (const p of activePlayers) {
      if (CARD_VALUES[p.hand[0]] > CARD_VALUES[winner.hand[0]]) winner = p;
    }
    endRound(room, winner);
    return;
  }

  do {
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
  } while (room.players[room.currentPlayerIndex].eliminated);

  room.turn++;
  const current = room.players[room.currentPlayerIndex];
  current.hand.push(room.deck.pop());
  io.to(current.id).emit('yourHand', current.hand);
  emitTurnUpdate(room);
  io.to(room.code).emit('roomUpdate', sanitizeRoom(room));
}

function endRound(room, winner) {
  winner.tokens += 1;
  io.to(room.code).emit('roundEnd', { winner: winner.name, tokens: winner.tokens });

  if (winner.tokens >= room.config.winTokens) {
    io.to(room.code).emit('gameWon', { winner: winner.name });
    room.gameStarted = false;
    room.roundActive = false;
    for (const p of room.players) p.tokens = 0;
    io.to(room.code).emit('roomUpdate', sanitizeRoom(room));
    return;
  }

  setTimeout(() => startNewRound(room), 3000);
}

function applyCardEffect(room, player, cardKey, targetId, guardGuess, copiedCard = null) {
  const target = targetId ? room.players.find(p => p.id === targetId) : null;
  const actualCard = cardKey === 'spy' ? copiedCard : cardKey;

  if (actualCard === null) return true;

  switch (actualCard) {
    case 'guard': {
      if (!target || target.protected) return true;
      if (!guardGuess) return true;
      if (CARD_VALUES[target.hand[0]] === guardGuess) {
        target.eliminated = true;
        io.to(room.code).emit('playerEliminated', { playerId: target.id, reason: 'guard' });
        io.to(room.code).emit('roomUpdate', sanitizeRoom(room));
      } else {
        io.to(room.code).emit('guardWrong', { playerId: player.id, targetId: target.id });
      }
      return true;
    }

    case 'priest':
      if (target && !target.protected) {
        io.to(player.id).emit('viewCard', { card: target.hand[0] });
      }
      return true;

    case 'baron':
      if (target && !target.protected) {
        const pVal = CARD_VALUES[player.hand[0]];
        const tVal = CARD_VALUES[target.hand[0]];
        if (pVal > tVal) {
          target.eliminated = true;
          io.to(room.code).emit('playerEliminated', { playerId: target.id, reason: 'baron' });
          io.to(room.code).emit('roomUpdate', sanitizeRoom(room));
        } else if (tVal > pVal) {
          player.eliminated = true;
          io.to(room.code).emit('playerEliminated', { playerId: player.id, reason: 'baron' });
          io.to(room.code).emit('roomUpdate', sanitizeRoom(room));
        }
      }
      return true;

    case 'handmaid':
      player.protected = true;
      io.to(room.code).emit('roomUpdate', sanitizeRoom(room));
      return true;

    case 'prince': {
      const chosen = target || player;
      if (chosen.protected) return true;
      chosen.hand.pop();
      if (chosen.hand.length > 0 && chosen.hand[0] === 'princess') {
        chosen.eliminated = true;
        io.to(room.code).emit('playerEliminated', { playerId: chosen.id, reason: 'prince' });
        io.to(room.code).emit('roomUpdate', sanitizeRoom(room));
      } else if (room.deck.length > 0) {
        chosen.hand.push(room.deck.pop());
      }
      io.to(chosen.id).emit('yourHand', chosen.hand);
      return true;
    }

    case 'chancellor': {
      if (room.deck.length >= 2) {
        player.hand.push(room.deck.pop(), room.deck.pop());
        io.to(player.id).emit('yourHand', player.hand);
        room.pendingChancellor = { playerId: player.id };
        return false;
      }
      return true;
    }

    case 'king':
      if (target && !target.protected) {
        const temp = player.hand[0];
        player.hand[0] = target.hand[0];
        target.hand[0] = temp;
        io.to(player.id).emit('yourHand', player.hand);
        io.to(target.id).emit('yourHand', target.hand);
      }
      return true;

    case 'countess':
      return true;

    case 'princess':
      player.eliminated = true;
      io.to(room.code).emit('playerEliminated', { playerId: player.id, reason: 'princess' });
      io.to(room.code).emit('roomUpdate', sanitizeRoom(room));
      return true;

    default:
      return true;
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
