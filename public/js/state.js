// Client-side state: element list + undo stack (local only)
const state = {
  elements: [],       // all canvas elements from server
  undoStack: [],      // local undo: elements I've drawn (indices into elements)
  tool: 'pen',
  color: '#F43F5E',
  strokeWidth: 3,
  shapeAutoCorrect: true,
  username: '',
  roomId: '',
  socket: null,

  currentStroke: null,  // local in-progress stroke
  remoteStrokes: new Map(), // socketId -> in-progress stroke from remote user
  isDrawing: false,
  eraserHoverIdx: -1,   // index of element hovered by eraser
};

function pushElement(el) {
  state.elements.push(el);
  state.undoStack.push(state.elements.length - 1);
}

function undo() {
  if (state.undoStack.length === 0) return;
  const idx = state.undoStack.pop();
  if (idx >= 0 && idx < state.elements.length) {
    state.socket.emit('erase-element', idx);
    state.elements.splice(idx, 1);
    // adjust undo stack indices
    for (let i = 0; i < state.undoStack.length; i++) {
      if (state.undoStack[i] > idx) state.undoStack[i]--;
    }
    redrawAll();
  }
}

function clearCanvas() {
  state.socket.emit('clear-canvas');
  state.elements = [];
  state.undoStack = [];
  redrawAll();
}
