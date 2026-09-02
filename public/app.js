const socket = io();

let myRoomCode = null;
let myPlayerId = null;
let myHand = [];
let currentTurnPlayerId = null;
let lastPlayedCard = null;
let pendingAction = null;
let players = [];
let playLog = [];
let handmaidProtection = false;
let handmaidTarget = null;
let handmaidPlayerId = null;

const DEFAULT_CARD_COUNTS = {
  guard: 5, priest: 2, baron: 2, handmaid: 2, prince: 2,
  chancellor: 2, king: 1, countess: 1, princess: 1, spy: 2
};

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

// Socket event handlers (same as before, but we'll adjust updatePlayersDisplay)
socket.on('roomCreated', ({ code, room }) => {
  myRoomCode = code;
  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
  document.getElementById('room-code-display').textContent = code;
  updateRoom(room);
});

socket.on('joinedRoom', ({ code }) => {
  myRoomCode = code;
  document.getElementById('menu').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
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

socket.on('turnUpdate', ({ currentPlayerId, turn, deckSize, lastPlayedCard: last, handmaidProtection: hp, handmaidTarget: ht, handmaidPlayerId: hpid }) => {
  currentTurnPlayerId = currentPlayerId;
  lastPlayedCard = last;
  handmaidProtection = hp;
  handmaidTarget = ht;
  handmaidPlayerId = hpid;
  if (currentPlayerId !== socket.id) pendingAction = null;
  document.getElementById('deck-count').textContent = deckSize;
  const currentPlayer = players.find(p => p.id === currentPlayerId);
  updateStatus(`Turn ${turn} - ${currentPlayer ? currentPlayer.name : 'Unknown'}'s turn`);
  if (currentPlayerId === socket.id) {
    updateStatus('Your turn! Play a card.');
  }
  document.getElementById('last-played-info').textContent = last ? `Last played: ${last}` : '';
  updatePlayersDisplay();
});

socket.on('cardPlayed', ({ playerId, cardKey, targetId, playerName, targetName }) => {
  const player = players.find(p => p.id === playerId);
  if (player) {
    player.lastPlayedCard = cardKey;
  }
  let logEntry = `${playerName} played ${cardKey}`;
  if (targetId && targetName) {
    logEntry += ` on ${targetName}`;
  }
  playLog.push(logEntry);
  renderPlayLog();
  updateStatus(logEntry);
  updatePlayersDisplay();
});

socket.on('playerEliminated', ({ playerId, reason, revealedCard, playerName }) => {
  const player = players.find(p => p.id === playerId);
  if (player) {
    player.eliminated = true;
    player.lastPlayedCard = null;
  }
  const logEntry = `${playerName} eliminated (${reason}). Revealed card: ${revealedCard}`;
  playLog.push(logEntry);
  renderPlayLog();
  updateStatus(logEntry);
  updatePlayersDisplay();
});

socket.on('handmaidActivated', ({ playerId, targetId }) => {
  const player = players.find(p => p.id === playerId);
  const target = players.find(p => p.id === targetId);
  if (player && target) {
    const msg = `${player.name} played Handmaid. ${target.name} is now the only target.`;
    playLog.push(msg);
    renderPlayLog();
    updateStatus(msg);
  }
});

socket.on('handmaidExpired', () => {
  handmaidProtection = false;
  handmaidTarget = null;
  handmaidPlayerId = null;
  updatePlayersDisplay();
});

socket.on('roundEnd', ({ winner, tokens }) => {
  alert(`${winner} wins the round! (${tokens} tokens)`);
  playLog = [];
  renderPlayLog();
  players.forEach(p => p.lastPlayedCard = null);
  updatePlayersDisplay();
});

socket.on('gameWon', ({ winner }) => {
  alert(`${winner} wins the game!`);
  playLog = [];
  renderPlayLog();
  players.forEach(p => p.lastPlayedCard = null);
  updatePlayersDisplay();
  document.getElementById('start-game').style.display = 'block';
});

socket.on('error', (msg) => alert(msg));
socket.on('viewCard', ({ card }) => alert(`You see: ${card}`));
socket.on('guardWrong', ({ playerId, targetId }) => {
  const player = players.find(p => p.id === playerId);
  const target = players.find(p => p.id === targetId);
  if (player && target) {
    const msg = `${player.name} guessed wrong against ${target.name}`;
    playLog.push(msg);
    renderPlayLog();
    updateStatus(msg);
  }
});

function updateRoom(room) {
  myRoomCode = room.code;
  document.getElementById('room-code-display').textContent = room.code;
  players = room.players.map(p => {
    const existing = players.find(ep => ep.id === p.id);
    return {
      ...p,
      lastPlayedCard: existing ? existing.lastPlayedCard : null
    };
  });
  handmaidProtection = room.handmaidProtection || false;
  handmaidTarget = room.handmaidTarget;
  handmaidPlayerId = room.handmaidPlayerId;
  if (room.host === socket.id && !room.gameStarted) {
    document.getElementById('start-game').style.display = 'block';
    document.getElementById('start-game').onclick = () => socket.emit('startGame');
  } else {
    document.getElementById('start-game').style.display = 'none';
  }
  lastPlayedCard = room.lastPlayedCard;
  updatePlayersDisplay();
}

function updatePlayersDisplay() {
  const container = document.getElementById('players-container');
  container.innerHTML = '';
  const total = players.length;
  if (total === 0) return;

  // Determine own index for positioning at bottom center
  let ownIndex = players.findIndex(p => p.id === socket.id);
  if (ownIndex === -1) ownIndex = 0;

  // Define position sets for different player counts
  // Each set is an array of {x, y} in percentage relative to container
  const positionSets = {
    1: [{ x: 50, y: 85 }],
    2: [
      { x: 50, y: 85 },  // own (bottom)
      { x: 50, y: 15 }   // top
    ],
    3: [
      { x: 50, y: 85 },  // own bottom
      { x: 15, y: 15 },  // top left
      { x: 85, y: 15 }   // top right
    ],
    4: [
      { x: 50, y: 85 },  // own bottom
      { x: 50, y: 15 },  // top
      { x: 15, y: 50 },  // left
      { x: 85, y: 50 }   // right
    ],
    5: [
      { x: 50, y: 85 },  // own bottom
      { x: 15, y: 15 },  // top left
      { x: 85, y: 15 },  // top right
      { x: 15, y: 50 },  // mid left
      { x: 85, y: 50 }   // mid right
    ],
    6: [
      { x: 50, y: 85 },  // own bottom
      { x: 15, y: 15 },  // top left
      { x: 85, y: 15 },  // top right
      { x: 15, y: 50 },  // mid left
      { x: 85, y: 50 },  // mid right
      { x: 50, y: 15 }   // top center
    ]
  };

  const positions = positionSets[total] || positionSets[4]; // fallback
  // We need to assign own player to index 0, others follow
  const orderedPlayers = [players[ownIndex], ...players.filter((_, i) => i !== ownIndex)];

  orderedPlayers.forEach((p, i) => {
    const pos = positions[i] || positions[0];
    const div = document.createElement('div');
    div.className = 'player';
    if (p.id === currentTurnPlayerId) div.classList.add('active');
    if (p.eliminated) div.classList.add('eliminated');
    div.style.left = pos.x + '%';
    div.style.top = pos.y + '%';
    div.style.transform = 'translate(-50%, -50%)';
    div.innerHTML = `
      <div class="name">${p.name}</div>
      <div class="hand-size">Hand: ${p.handSize}</div>
      <div class="tokens">Tokens: ${p.tokens}</div>
      <div class="played-card">${p.lastPlayedCard ? p.lastPlayedCard : ''}</div>
      ${handmaidProtection && p.id === handmaidTarget ? '<div class="handmaid-target">🎯 Targeted</div>' : ''}
      ${handmaidProtection && p.id === handmaidPlayerId ? '<div class="handmaid-protected">🛡️ Handmaid</div>' : ''}
    `;
    container.appendChild(div);
  });
}

function updateStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function renderPlayLog() {
  const logDiv = document.getElementById('play-log');
  if (!logDiv) {
    const gameDiv = document.getElementById('game');
    const log = document.createElement('div');
    log.id = 'play-log';
    log.style.marginTop = '20px';
    log.style.borderTop = '1px solid #555';
    log.style.paddingTop = '10px';
    log.innerHTML = '<h3>Play Log</h3>';
    gameDiv.appendChild(log);
  }
  logDiv.innerHTML = '<h3>Play Log</h3>' + playLog.map(entry => `<div>${entry}</div>`).join('');
}

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
  let needsTarget = ['guard', 'priest', 'baron', 'prince', 'king', 'handmaid'].includes(card);
  let needsGuardGuess = card === 'guard';

  if (isSpy) {
    if (lastPlayedCard && ['guard', 'priest', 'baron', 'prince', 'king', 'handmaid'].includes(lastPlayedCard)) {
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

function showTargetSelection(callback) {
  let availableTargets = players.filter(p => !p.eliminated);
  if (handmaidProtection && socket.id !== handmaidPlayerId) {
    availableTargets = availableTargets.filter(p => p.id === handmaidTarget || p.id === socket.id);
  }

  if (availableTargets.length === 0) {
    alert('No valid targets.');
    return;
  }
  const modal = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = '<h3>Select a target (including yourself if allowed):</h3>';
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
  confirmBtn.textContent = 'Next: Choose Order';
  confirmBtn.onclick = () => {
    const selected = [...handDiv.querySelectorAll('.selected')].map(el => parseInt(el.dataset.index));
    if (selected.length !== 2) return alert('Select exactly two cards.');
    const selectedCards = selected.map(idx => myHand[idx]);
    showOrderSelection(selectedCards, (order) => {
      socket.emit('chancellorReturn', { cardIndices: selected, order });
      modal.style.display = 'none';
      pendingAction = null;
    });
  };
  content.appendChild(confirmBtn);
  modal.style.display = 'flex';
}

function showOrderSelection(cards, callback) {
  const modal = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = '<h3>Which card should be drawn first?</h3>';
  cards.forEach((card) => {
    const btn = document.createElement('button');
    btn.textContent = card;
    btn.onclick = () => {
      const other = cards.find(c => c !== card);
      callback([card, other]);
      modal.style.display = 'none';
    };
    content.appendChild(btn);
  });
  modal.style.display = 'flex';
}
