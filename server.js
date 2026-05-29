const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Map(),
      elements: [],
      chatMessages: []
    });
  }
  return rooms.get(roomId);
}

function gcRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.users.size > 0) return;
  setTimeout(() => {
    const r = rooms.get(roomId);
    if (r && r.users.size === 0) rooms.delete(roomId);
  }, 5 * 60 * 1000);
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  socket.on('join-room', ({ roomId, username }) => {
    currentRoom = roomId;
    currentUser = { id: socket.id, username: username || 'Anonymous' };

    const room = getRoom(roomId);
    room.users.set(socket.id, currentUser);
    socket.join(roomId);

    socket.emit('room-state', {
      elements: room.elements,
      chatMessages: room.chatMessages.slice(-50),
      users: Array.from(room.users.values())
    });

    socket.to(roomId).emit('user-joined', currentUser);
    io.to(roomId).emit('user-list', Array.from(room.users.values()));
  });

  socket.on('draw-start', (data) => {
    if (currentRoom) socket.to(currentRoom).emit('draw-start', { ...data, socketId: socket.id });
  });

  socket.on('draw-move', (data) => {
    if (currentRoom) socket.to(currentRoom).emit('draw-move', { ...data, socketId: socket.id });
  });

  socket.on('draw-end', (data) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.elements.push(data);
    socket.to(currentRoom).emit('draw-end', { ...data, socketId: socket.id });
  });

  socket.on('erase-element', (elementIndex) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (elementIndex >= 0 && elementIndex < room.elements.length) {
      room.elements.splice(elementIndex, 1);
      io.to(currentRoom).emit('element-removed', elementIndex);
    }
  });

  socket.on('clear-canvas', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.elements = [];
    io.to(currentRoom).emit('canvas-cleared');
  });

  socket.on('chat-message', (msg) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    const message = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username: currentUser.username,
      text: msg.text,
      timestamp: Date.now()
    };
    room.chatMessages.push(message);
    if (room.chatMessages.length > 200) room.chatMessages.shift();
    io.to(currentRoom).emit('chat-message', message);
  });

  socket.on('webrtc-offer', (data) => {
    socket.to(data.to).emit('webrtc-offer', { from: socket.id, offer: data.offer });
  });

  socket.on('webrtc-answer', (data) => {
    socket.to(data.to).emit('webrtc-answer', { from: socket.id, answer: data.answer });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    socket.to(data.to).emit('webrtc-ice-candidate', { from: socket.id, candidate: data.candidate });
  });

  socket.on('voice-join', () => {
    if (currentRoom) socket.to(currentRoom).emit('voice-join', socket.id);
  });

  socket.on('voice-leave', () => {
    if (currentRoom) socket.to(currentRoom).emit('voice-leave', socket.id);
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users.delete(socket.id);
        socket.to(currentRoom).emit('user-left', socket.id);
        io.to(currentRoom).emit('user-list', Array.from(room.users.values()));
        if (room.users.size === 0) gcRoom(currentRoom);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
