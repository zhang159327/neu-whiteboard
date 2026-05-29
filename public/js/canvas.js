// Canvas rendering and input handling
const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
const container = document.getElementById('canvas-container');

let textInputOverlay = document.getElementById('text-input-overlay');
let textInput = document.getElementById('text-input');

function resizeCanvas() {
  const rect = container.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  redrawAll();
}

function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < state.elements.length; i++) {
    drawElement(state.elements[i]);
  }
  // Eraser hover highlight
  if (state.tool === 'eraser' && state.eraserHoverIdx >= 0 && state.eraserHoverIdx < state.elements.length) {
    highlightElement(state.elements[state.eraserHoverIdx]);
  }
  if (state.currentStroke) drawElement(state.currentStroke);
  for (const stroke of state.remoteStrokes.values()) drawElement(stroke);
}

function highlightElement(el) {
  ctx.save();
  ctx.strokeStyle = '#F43F5E';
  ctx.fillStyle = 'rgba(244, 63, 94, 0.12)';
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 3]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (el.type) {
    case 'rect': {
      const x = Math.min(el.x, el.x + el.w), y = Math.min(el.y, el.y + el.h);
      ctx.beginPath(); ctx.rect(x - 3, y - 3, Math.abs(el.w) + 6, Math.abs(el.h) + 6);
      ctx.stroke(); ctx.fill(); break;
    }
    case 'circle':
      ctx.beginPath(); ctx.arc(el.cx, el.cy, Math.max(el.rx, el.ry) + 4, 0, Math.PI * 2);
      ctx.stroke(); ctx.fill(); break;
    case 'line':
      ctx.beginPath(); ctx.moveTo(el.x1, el.y1); ctx.lineTo(el.x2, el.y2);
      ctx.stroke(); break;
    case 'text':
      ctx.beginPath(); ctx.rect(el.x - 4, el.y - 20, 108, 28);
      ctx.stroke(); ctx.fill(); break;
    case 'pen': {
      if (el.points.length < 2) {
        ctx.beginPath(); ctx.arc(el.points[0].x, el.points[0].y, 12, 0, Math.PI * 2);
        ctx.stroke(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

function drawElement(el) {
  ctx.strokeStyle = el.color || '#000';
  ctx.fillStyle = el.color || '#000';
  ctx.lineWidth = el.strokeWidth || 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (el.type) {
    case 'pen':
      if (el.points.length < 2) {
        ctx.beginPath();
        ctx.arc(el.points[0].x, el.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.points[i].x, el.points[i].y);
      }
      ctx.stroke();
      break;

    case 'line':
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();
      break;

    case 'rect': {
      const x = Math.min(el.x, el.x + el.w);
      const y = Math.min(el.y, el.y + el.h);
      const w = Math.abs(el.w);
      const h = Math.abs(el.h);
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();
      break;
    }

    case 'circle':
      ctx.beginPath();
      ctx.ellipse(el.cx, el.cy, el.rx, el.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;

    case 'text':
      ctx.font = `${Math.max(el.strokeWidth * 5 || 16, 12)}px sans-serif`;
      ctx.fillText(el.text, el.x, el.y);
      break;
  }
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('mousedown', (e) => {
  if (state.tool === 'text') {
    const pos = getCanvasPos(e);
    tools.text.onStart(pos.x, pos.y);
    return;
  }
  state.isDrawing = true;
  const pos = getCanvasPos(e);
  const tool = tools[state.tool];
  tool.onStart(pos.x, pos.y);
  state.socket.emit('draw-start', { tool: state.tool, x: pos.x, y: pos.y, color: state.color, strokeWidth: state.strokeWidth });
});

canvas.addEventListener('mousemove', (e) => {
  if (!state.isDrawing) return;
  const pos = getCanvasPos(e);
  const tool = tools[state.tool];
  tool.onMove(pos.x, pos.y);
  if (state.currentStroke) {
    state.socket.emit('draw-move', { x: pos.x, y: pos.y });
  }
  redrawAll();
});

canvas.addEventListener('mouseup', (e) => {
  if (!state.isDrawing) return;
  state.isDrawing = false;
  const pos = getCanvasPos(e);
  const tool = tools[state.tool];
  tool.onEnd(pos.x, pos.y);
});

canvas.addEventListener('mouseleave', () => {
  if (state.isDrawing) {
    state.isDrawing = false;
    if (state.currentStroke) {
      const tool = tools[state.tool];
      tool.onEnd(state.currentStroke.points ? state.currentStroke.points[state.currentStroke.points.length - 1]?.x || 0 : 0, 0);
    }
  }
});

// Touch events
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  const mouseEvent = new MouseEvent('mousedown', { clientX: touch.clientX, clientY: touch.clientY });
  canvas.dispatchEvent(mouseEvent);
});

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  const mouseEvent = new MouseEvent('mousemove', { clientX: touch.clientX, clientY: touch.clientY });
  canvas.dispatchEvent(mouseEvent);
});

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  const mouseEvent = new MouseEvent('mouseup', {});
  canvas.dispatchEvent(mouseEvent);
});

// Text input
function showTextInput(x, y) {
  textInputOverlay.style.display = 'block';
  textInputOverlay.style.left = x + 'px';
  textInputOverlay.style.top = (y - 10) + 'px';
  textInput.value = '';
  textInput.focus();
  textInput._pos = { x, y };
}

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = textInput.value.trim();
    if (text) {
      const el = {
        type: 'text',
        x: textInput._pos.x,
        y: textInput._pos.y,
        text,
        color: state.color,
        strokeWidth: state.strokeWidth,
      };
      pushElement(el);
      state.socket.emit('draw-end', el);
      redrawAll();
    }
    textInputOverlay.style.display = 'none';
  }
  if (e.key === 'Escape') {
    textInputOverlay.style.display = 'none';
  }
});

// Cursor + eraser hover
canvas.addEventListener('mousemove', (e) => {
  if (!state.isDrawing) {
    const tool = tools[state.tool];
    canvas.style.cursor = tool.cursor;
    // Eraser hover highlight
    if (state.tool === 'eraser') {
      const pos = getCanvasPos(e);
      const prev = state.eraserHoverIdx;
      state.eraserHoverIdx = findElementAt(pos.x, pos.y);
      if (prev !== state.eraserHoverIdx) redrawAll();
    } else if (state.eraserHoverIdx !== -1) {
      state.eraserHoverIdx = -1;
      redrawAll();
    }
  }
});

window.addEventListener('resize', resizeCanvas);
