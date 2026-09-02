const socket = io();

let myRoomCode = null;
let myPlayerId = null;
let myHand = [];
let currentTurnPlayerId = null;
let lastPlayedCard = null;
let pendingAction = null;
let players = [];   // array of player objects including lastPlayedCard
let playLog = [];

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
  document.getElementById('deck-count').textContent = deckSize;
  const currentPlayer = players.find(p => p.id === currentPlayerId);
  updateStatus(`Turn ${turn} - ${currentPlayer ? currentPlayer.name : 'Unknown'}'s turn`);
  if (currentPlayerId === socket.id) {
    updateStatus('Your turn! Play a card.');
  }
  document.getElementById('last-played-info').textContent = last ? `Last played: ${last}` : '';
  updatePlayersDisplay();
});

socket.on('cardPlayed', ({ playerId, cardKey }) => {
  const player = players.find(p => p.id === playerId);
  if (player) {
    player.lastPlayedCard = cardKey;
  }
  const playerName = player ? player.name : 'Unknown';
  playLog.push(`${playerName} played ${cardKey}`);
  renderPlayLog();
  updateStatus(`${playerName} played ${cardKey}`);
  updatePlayersDisplay();
});

socket.on('playerEliminated', ({ playerId, reason }) => {
  const player = players.find(p => p.id === playerId);
  if (player) player.eliminated = true;
  const playerName = player ? player.name : 'Unknown';
  updateStatus(`${playerName} eliminated (${reason})`);
  updatePlayersDisplay();
});

socket.on('roundEnd', ({ winner, tokens }) => {
  alert(`${winner} wins the round! (${tokens} tokens)`);
  playLog = [];
  renderPlayLog();
  // Clear played cards for new round
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
  if (player && target) updateStatus(`${player.name} guessed wrong against ${target.name}`);
});

function updateRoom(room) {
  myRoomCode = room.code;
  document.getElementById('room-code-display').textContent = room.code;
  // Merge room players with our extended state (lastPlayedCard)
  players = room.players.map(p => {
    const existing = players.find(ep => ep.id === p.id);
    return {
      ...p,
      lastPlayedCard: existing ? existing.lastPlayedCard : null
    };
  });
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
  const positions = getPositions(total);
  players.forEach((p, index) => {
    const div = document.createElement('div');
    div.className = 'player';
    if (p.id === currentTurnPlayerId) div.classList.add('active');
    if (p.eliminated) div.classList.add('eliminated');
    const pos = positions[index];
    div.style.left = pos.x + '%';
    div.style.top = pos.y + '%';
    div.style.transform = 'translate(-50%, -50%)';
    div.innerHTML = `
      <div class="name">${p.name}</div>
      <div class="hand-size">Hand: ${p.handSize}</div>
      <div class="tokens">Tokens: ${p.tokens}</div>
      <div class="played-card">${p.lastPlayedCard || ''}</div>
    `;
    container.appendChild(div);
  });
}

function getPositions(total) {
  switch(total) {
    case 1:
      return [
        { x: 50, y: 50 }   // center
      ];
    case 2:
      return [
        { x: 50, y: 10 },  // top
        { x: 50, y: 90 }   // bottom
      ];
    case 3:
      return [
        { x: 50, y: 10 },  // top
        { x: 20, y: 80 },  // bottom left
        { x: 80, y: 80 }   // bottom right
      ];
    case 4:
      return [
        { x: 50, y: 10 },  // top
        { x: 90, y: 50 },  // right
        { x: 50, y: 90 },  // bottom
        { x: 10, y: 50 }   // left
      ];
    default:
      return [];
  }
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
      callback([card, other]); // first element drawn first
      modal.style.display = 'none';
    };
    content.appendChild(btn);
  });
  modal.style.display = 'flex';
}
