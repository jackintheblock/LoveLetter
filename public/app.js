const socket = io(); // auto-connects to same host

let myRoomCode = null;
let myPlayerId = null;
let myHand = [];
let currentTurnPlayerId = null;
let lastPlayedCard = null;
let pendingAction = null;
let players = [];

const DEFAULT_CARD_COUNTS = {
  guard: 5, priest: 2, baron: 2, handmaid: 2, prince: 2,
  chancellor: 2, king: 1, countess: 1, princess: 1, spy: 2
};

// ---------- Setup UI ----------
function renderCardCountInputs() {
  const container = document.getElementById('card-counts');
  container.innerHTML = '';
  for (const [key, count] of Object.entries(DEFAULT_CARD_COUNTS)) {
    const row = document.createElement('div');
    row.className = 'card-count-row';
    row.innerHTML = `
      <label>${key}:</label>
      <input type="number" min="0" max="10" value="${count}" data-card="${key}">
    `;
    container.appendChild(row);
  }
}
renderCardCountInputs();

document.getElementById('create-btn').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim();
  if (!name) return alert('Enter your name');
  const counts = {};
  document.querySelectorAll('#card-counts input').forEach(input => {
    counts[input.dataset.card] = parseInt(input.value) || 0;
  });
  const winTokens = parseInt(document.getElementById('win-tokens').value) || 4;
  socket.emit('createRoom', { playerName: name, cardCounts: counts, winTokens });
});

document.getElementById('join-btn').addEventListener('click', () => {
  const code = document.getElementById('room-code').value.trim().toUpperCase();
  const name = document.getElementById('join-name').value.trim();
  if (!code || !name) return alert('Enter room code and name');
  socket.emit('joinRoom', { roomCode: code, playerName: name });
});

// ---------- Socket Handlers ----------
socket.on('roomCreated', ({ code, room }) => {
  myRoomCode = code;
  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  document.getElementById('room-code-display').textContent = code;
  updateRoom(room);
});

socket.on('joinedRoom', ({ code }) => {
  myRoomCode = code;
  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  document.getElementById('room-code-display').textContent = code;
});

socket.on('roomUpdate', (room) => updateRoom(room));

socket.on('gameStarted', (room) => {
  document.getElementById('start-game').style.display = 'none';
  updateRoom(room);
});

socket.on('yourHand', (hand) => {
  myHand = hand;
  renderHand();
  if (pendingAction && pendingAction.type === 'chancellor') {
    showChancellorReturn();
  }
});

socket.on('turnUpdate', ({ currentPlayerId, turn, deckSize, lastPlayedCard: last }) => {
  currentTurnPlayerId = currentPlayerId;
  lastPlayedCard = last;
  if (currentPlayerId !== socket.id) pendingAction = null;
  updateStatus(`Turn ${turn} - Waiting for player...`);
  if (currentPlayerId === socket.id) {
    updateStatus('Your turn! Play a card.');
  }
  document.getElementById('last-played').textContent = last ? `Last played: ${last}` : '';
});

socket.on('cardPlayed', ({ playerId, cardKey }) => {
  updateStatus(`Player ${playerId} played ${cardKey}`);
});

socket.on('playerEliminated', ({ playerId, reason }) => {
  updateStatus(`Player eliminated (${reason})`);
});

socket.on('roundEnd', ({ winner, tokens }) => {
  alert(`${winner} wins the round! (${tokens} tokens)`);
});

socket.on('gameWon', ({ winner }) => {
  alert(`${winner} wins the game!`);
  document.getElementById('start-game').style.display = 'block';
});

socket.on('error', (msg) => alert(msg));

socket.on('viewCard', ({ card }) => {
  alert(`You see: ${card}`);
});

socket.on('guardWrong', ({ playerId, targetId }) => {
  // Optional feedback
});

// ---------- Room Update ----------
function updateRoom(room) {
  myRoomCode = room.code;
  document.getElementById('room-code-display').textContent = room.code;
  players = room.players;
  const playersDiv = document.getElementById('players');
  playersDiv.innerHTML = '';
  room.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player';
    if (p.id === currentTurnPlayerId) div.classList.add('active');
    if (p.eliminated) div.classList.add('eliminated');
    div.innerHTML = `${p.name} (${p.handSize} cards)${p.protected ? ' 🛡️' : ''}${p.eliminated ? ' 💀' : ''} - Tokens: ${p.tokens}`;
    playersDiv.appendChild(div);
  });
  if (room.host === socket.id && !room.gameStarted) {
    document.getElementById('start-game').style.display = 'block';
    document.getElementById('start-game').onclick = () => socket.emit('startGame');
  } else {
    document.getElementById('start-game').style.display = 'none';
  }
  lastPlayedCard = room.lastPlayedCard;
}

function updateStatus(msg) {
  document.getElementById('status').textContent = msg;
}

// ---------- Hand Rendering ----------
function renderHand() {
  const handDiv = document.getElementById('hand');
  handDiv.innerHTML = '';
  myHand.forEach((card, index) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.textContent = card;
    div.onclick = () => onCardClick(index);
    handDiv.appendChild(div);
  });
}

function onCardClick(cardIndex) {
  if (currentTurnPlayerId !== socket.id) return;
  if (pendingAction) return;

  const card = myHand[cardIndex];
  const isSpy = card === 'spy';
  let needsTarget = ['guard', 'priest', 'baron', 'prince', 'king'].includes(card);
  let needsGuardGuess = card === 'guard';

  if (isSpy) {
    if (lastPlayedCard && ['guard', 'priest', 'baron', 'prince', 'king'].includes(lastPlayedCard)) {
      needsTarget = true;
      if (lastPlayedCard === 'guard') needsGuardGuess = true;
    } else if (lastPlayedCard === 'chancellor') {
      pendingAction = { type: 'chancellor' };
      socket.emit('playCard', { cardIndex });
      return;
    } else {
      socket.emit('playCard', { cardIndex });
      return;
    }
  }

  if (needsGuardGuess) {
    showTargetSelection((targetId) => {
      showGuardGuess((guess) => {
        socket.emit('playCard', { cardIndex, targetId, guardGuess: guess });
      });
    });
  } else if (needsTarget) {
    showTargetSelection((targetId) => {
      socket.emit('playCard', { cardIndex, targetId });
    });
  } else if (card === 'chancellor') {
    pendingAction = { type: 'chancellor' };
    socket.emit('playCard', { cardIndex });
  } else {
    socket.emit('playCard', { cardIndex });
  }
}

// ---------- Modals ----------
function showTargetSelection(callback) {
  const availableTargets = players.filter(p => p.id !== socket.id && !p.eliminated && !p.protected);
  if (availableTargets.length === 0) {
    alert('No valid targets.');
    return;
  }
  const modal = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = '<h3>Select a target:</h3>';
  availableTargets.forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = p.name;
    btn.onclick = () => {
      modal.style.display = 'none';
      callback(p.id);
    };
    content.appendChild(btn);
  });
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.onclick = () => modal.style.display = 'none';
  content.appendChild(cancel);
  modal.style.display = 'flex';
}

function showGuardGuess(callback) {
  const modal = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = '<h3>Guess a card (2-9):</h3>';
  for (let val = 2; val <= 9; val++) {
    const btn = document.createElement('button');
    btn.textContent = val;
    btn.onclick = () => {
      modal.style.display = 'none';
      callback(val);
    };
    content.appendChild(btn);
  }
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.onclick = () => modal.style.display = 'none';
  content.appendChild(cancel);
  modal.style.display = 'flex';
}

function showChancellorReturn() {
  const modal = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = '<h3>Choose two cards to put back on deck:</h3>';
  const handDiv = document.createElement('div');
  myHand.forEach((card, idx) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.textContent = card;
    cardEl.dataset.index = idx;
    cardEl.onclick = () => {
      cardEl.classList.toggle('selected');
    };
    handDiv.appendChild(cardEl);
  });
  content.appendChild(handDiv);
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Return Selected';
  confirmBtn.onclick = () => {
    const selected = [...handDiv.querySelectorAll('.selected')].map(el => parseInt(el.dataset.index));
    if (selected.length !== 2) return alert('Select exactly two cards.');
    socket.emit('chancellorReturn', { cardIndices: selected });
    modal.style.display = 'none';
    pendingAction = null;
  };
  content.appendChild(confirmBtn);
  modal.style.display = 'flex';
}