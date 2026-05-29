// App entry point — Socket.io, UI bindings, event routing

/* ---- DOM refs ---- */
const joinScreen = document.getElementById('join-screen');
const workspace = document.getElementById('workspace');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const undoBtn = document.getElementById('undo-btn');
const clearBtn = document.getElementById('clear-btn');
const voiceBtn = document.getElementById('voice-btn');
const shapeToggle = document.getElementById('shape-toggle');
const colorPicker = document.getElementById('color-picker');
const strokeWidthSlider = document.getElementById('stroke-width');
const roomLabel = document.getElementById('room-label');
const userCount = document.getElementById('user-count');
const userCountBtn = document.getElementById('user-count-btn');
const userListPanel = document.getElementById('user-list-panel');
const userList = document.getElementById('user-list');
const userListCount = document.getElementById('user-list-count');
const toastContainer = document.getElementById('toast-container');
const statusMsg = document.getElementById('status-msg');
const statusTool = document.getElementById('status-tool');
const statusColor = document.getElementById('status-color');
const statusWidth = document.getElementById('status-width');
const chatBadge = document.getElementById('chat-badge');
const drawHint = document.getElementById('draw-hint');
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const statusDot = document.getElementById('status-dot');
const chatPanel = document.getElementById('chat-panel');

const toolLabels = {
  pen: '画笔', line: '直线', rect: '矩形',
  circle: '圆形', text: '文字', eraser: '橡皮擦',
};

function updateStatusBar() {
  statusTool.textContent = toolLabels[state.tool];
  statusColor.textContent = state.color;
  statusWidth.textContent = state.strokeWidth + 'px';
}

/* ---- Smart room name ---- */
function randomRoomName() {
  const adj = ['青空','星夜','晨曦','暮光','流云','碧海','银河','极光','霜华','朝露','松风','竹影','雪域','夕照','微雨','晴岚'];
  const noun = ['海豚','猫头鹰','白鸽','蓝鲸','火狐','雪豹','青鸟','灵鹿','银鹰','锦鲤','夜莺','飞鱼','冰熊','朱鹮','玄龟','彩蝶'];
  return adj[Math.floor(Math.random() * adj.length)] + '·' + noun[Math.floor(Math.random() * noun.length)];
}

/* ---- Join ---- */
joinBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim() || '匿名用户';
  const roomId = roomInput.value.trim() || randomRoomName();

  state.username = username;
  state.roomId = roomId;

  const socket = io();
  state.socket = socket;

  socket.on('connect', () => {
    setConnected(true);
    socket.emit('join-room', { roomId, username });
  });

  socket.on('disconnect', () => {
    setConnected(false);
  });

  socket.on('room-state', (data) => {
    state.elements = data.elements || [];
    redrawAll();
    chatMessages.innerHTML = '';
    if (data.chatMessages) {
      for (const msg of data.chatMessages) addChatMessage(msg);
    }
    if (data.users) updateUserList(data.users);

    joinScreen.style.display = 'none';
    workspace.style.display = 'flex';
    roomLabel.textContent = roomId;
    resizeCanvas();
    updateStatusBar();
    addSystemMessage('你加入了房间「' + roomId + '」');
  });

  socket.on('user-joined', (user) => {
    addSystemMessage(user.username + ' 加入了房间');
    if (webrtc.active) webrtc.handleNewPeer(user.id);
  });

  socket.on('user-list', (users) => updateUserList(users));

  // Remote drawing
  socket.on('draw-start', (data) => {
    let stroke;
    if (data.tool === 'pen') {
      stroke = { type: 'pen', points: [{ x: data.x, y: data.y }], color: data.color, strokeWidth: data.strokeWidth };
    } else if (data.tool === 'line') {
      stroke = { type: 'line', x1: data.x, y1: data.y, x2: data.x, y2: data.y, color: data.color, strokeWidth: data.strokeWidth };
    } else if (data.tool === 'rect') {
      stroke = { type: 'rect', x: data.x, y: data.y, w: 0, h: 0, color: data.color, strokeWidth: data.strokeWidth };
    } else if (data.tool === 'circle') {
      stroke = { type: 'circle', cx: data.x, cy: data.y, rx: 0, ry: 0, color: data.color, strokeWidth: data.strokeWidth };
    }
    if (stroke) state.remoteStrokes.set(data.socketId, stroke);
    redrawAll();
  });

  socket.on('draw-move', (data) => {
    const s = state.remoteStrokes.get(data.socketId);
    if (!s) return;
    if (s.type === 'pen') { s.points.push({ x: data.x, y: data.y }); }
    else if (s.type === 'line') { s.x2 = data.x; s.y2 = data.y; }
    else if (s.type === 'rect') { s.w = data.x - s.x; s.h = data.y - s.y; }
    else if (s.type === 'circle') { s.rx = Math.abs(data.x - s.cx); s.ry = Math.abs(data.y - s.cy); }
    redrawAll();
  });

  socket.on('draw-end', (data) => {
    state.remoteStrokes.delete(data.socketId);
    state.elements.push(data);
    redrawAll();
  });

  socket.on('user-left', (socketId) => {
    state.remoteStrokes.delete(socketId);
    redrawAll();
    webrtc.handlePeerLeft(socketId);
  });

  socket.on('element-removed', (index) => {
    if (index >= 0 && index < state.elements.length) {
      state.elements.splice(index, 1);
      redrawAll();
    }
  });

  socket.on('canvas-cleared', () => {
    state.elements = [];
    state.undoStack = [];
    redrawAll();
    addSystemMessage('画布已被清空');
  });

  // Chat
  socket.on('chat-message', (msg) => {
    addChatMessage(msg);
    const panel = document.getElementById('chat-messages');
    const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 40;
    if (!atBottom) chatBadge.hidden = false;
  });

  // WebRTC signaling
  socket.on('voice-join', (socketId) => {
    if (webrtc.active) webrtc.handleNewPeer(socketId);
  });
  socket.on('voice-leave', (socketId) => webrtc.handlePeerLeft(socketId));
  socket.on('webrtc-offer', (d) => webrtc.handleOffer(d.from, d.offer));
  socket.on('webrtc-answer', (d) => webrtc.handleAnswer(d.from, d.answer));
  socket.on('webrtc-ice-candidate', (d) => webrtc.handleIceCandidate(d.from, d.candidate));

  roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });
});

/* ---- Tool selection ---- */
document.querySelectorAll('.tb-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tb-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.tool = btn.dataset.tool;
    updateStatusBar();
  });
});

/* ---- Color presets ---- */
document.querySelectorAll('.color-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    state.color = dot.dataset.color;
    colorPicker.value = dot.dataset.color;
    updateStatusBar();
  });
});

colorPicker.addEventListener('input', () => {
  state.color = colorPicker.value;
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
  updateStatusBar();
});

/* ---- Stroke width ---- */
strokeWidthSlider.addEventListener('input', () => {
  state.strokeWidth = parseInt(strokeWidthSlider.value);
  updateStatusBar();
});

/* ---- Undo / Clear ---- */
undoBtn.addEventListener('click', () => { undo(); toast('已撤销'); });

clearBtn.addEventListener('click', () => {
  if (confirm('确定要清空画布吗？所有人都会看到此操作。')) {
    clearCanvas();
    toast('画布已清空');
  }
});

/* ---- AI Shape toggle ---- */
shapeToggle.addEventListener('click', () => {
  state.shapeAutoCorrect = !state.shapeAutoCorrect;
  shapeToggle.classList.toggle('active', state.shapeAutoCorrect);
  toast(state.shapeAutoCorrect ? 'AI 形状修正：开' : 'AI 形状修正：关');
});

/* ---- Voice ---- */
voiceBtn.addEventListener('click', async () => {
  if (webrtc.active) {
    webrtc.leave();
    voiceBtn.classList.remove('voice-active');
    voiceBtn.querySelector('span').textContent = '语音';
    toast('已离开语音通话');
    statusMsg.textContent = '就绪';
  } else {
    voiceBtn.querySelector('span').textContent = '连接中…';
    const ok = await webrtc.join();
    if (ok) {
      voiceBtn.classList.add('voice-active');
      voiceBtn.querySelector('span').textContent = '通话中';
      toast('已加入语音通话');
      statusMsg.textContent = '语音通话中';
    } else {
      voiceBtn.querySelector('span').textContent = '语音';
      toast('无法访问麦克风，请检查浏览器权限');
    }
  }
});

/* ---- User list popover ---- */
let userListOpen = false;
userCountBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  userListOpen = !userListOpen;
  userListPanel.hidden = !userListOpen;
});
document.addEventListener('click', () => {
  if (userListOpen) { userListOpen = false; userListPanel.hidden = true; }
});
userListPanel.addEventListener('click', (e) => e.stopPropagation());

/* ---- Chat badge ---- */
chatBadge.addEventListener('click', () => {
  const panel = document.getElementById('chat-messages');
  panel.scrollTop = panel.scrollHeight;
  chatBadge.hidden = true;
});

/* ---- Mobile chat toggle ---- */
chatToggleBtn.addEventListener('click', () => {
  chatPanel.classList.toggle('open');
  chatToggleBtn.classList.toggle('active', chatPanel.classList.contains('open'));
});

/* ---- Status dot ---- */
function setConnected(connected) {
  if (connected) {
    statusDot.classList.remove('offline');
    statusMsg.textContent = '已连接';
  } else {
    statusDot.classList.add('offline');
    statusMsg.textContent = '未连接';
  }
}

/* ---- Draw hint ---- */
let hintHidden = false;
canvas.addEventListener('mousedown', () => {
  if (!hintHidden) { hintHidden = true; drawHint.style.opacity = '0'; }
}, { once: true });

/* ---- User list ---- */
function updateUserList(users) {
  userCount.textContent = users.length;
  userListCount.textContent = '共 ' + users.length + ' 人';
  userList.innerHTML = users.map(u => {
    const isMe = u.id === state.socket.id;
    return '<div class="user-item' + (isMe ? ' me' : '') + '">' +
      '<span class="user-dot online"></span>' +
      escapeHtml(u.username) +
      (isMe ? '<span class="user-tag">我</span>' : '') +
      '</div>';
  }).join('');
}

/* ---- Toast ---- */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
