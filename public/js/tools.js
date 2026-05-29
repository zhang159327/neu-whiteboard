// Drawing tool definitions
const tools = {
  pen: {
    cursor: 'crosshair',
    onStart(x, y) {
      state.currentStroke = {
        type: 'pen',
        points: [{ x, y }],
        color: state.color,
        strokeWidth: state.strokeWidth,
      };
    },
    onMove(x, y) {
      state.currentStroke.points.push({ x, y });
    },
    onEnd(x, y) {
      state.currentStroke.points.push({ x, y });
      if (state.shapeAutoCorrect && state.currentStroke.points.length > 5) {
        const corrected = shapeTouchup.tryCorrect(state.currentStroke);
        if (corrected) {
          state.currentStroke = corrected;
          const labelMap = { line: '直线', rectangle: '矩形', circle: '圆形' };
          toast(`AI 已修正为${labelMap[corrected._corrected] || '形状'}`);
        }
      }
      pushElement(state.currentStroke);
      state.socket.emit('draw-end', state.currentStroke);
      state.currentStroke = null;
      redrawAll();
    },
  },

  line: {
    cursor: 'crosshair',
    onStart(x, y) {
      state.currentStroke = {
        type: 'line',
        x1: x, y1: y,
        x2: x, y2: y,
        color: state.color,
        strokeWidth: state.strokeWidth,
      };
    },
    onMove(x, y) {
      state.currentStroke.x2 = x;
      state.currentStroke.y2 = y;
    },
    onEnd(x, y) {
      state.currentStroke.x2 = x;
      state.currentStroke.y2 = y;
      pushElement(state.currentStroke);
      state.socket.emit('draw-end', state.currentStroke);
      state.currentStroke = null;
      redrawAll();
    },
  },

  rect: {
    cursor: 'crosshair',
    onStart(x, y) {
      state.currentStroke = {
        type: 'rect',
        x: x, y: y,
        w: 0, h: 0,
        color: state.color,
        strokeWidth: state.strokeWidth,
      };
    },
    onMove(x, y) {
      state.currentStroke.w = x - state.currentStroke.x;
      state.currentStroke.h = y - state.currentStroke.y;
    },
    onEnd(x, y) {
      state.currentStroke.w = x - state.currentStroke.x;
      state.currentStroke.h = y - state.currentStroke.y;
      pushElement(state.currentStroke);
      state.socket.emit('draw-end', state.currentStroke);
      state.currentStroke = null;
      redrawAll();
    },
  },

  circle: {
    cursor: 'crosshair',
    onStart(x, y) {
      state.currentStroke = {
        type: 'circle',
        cx: x, cy: y,
        rx: 0, ry: 0,
        color: state.color,
        strokeWidth: state.strokeWidth,
      };
    },
    onMove(x, y) {
      state.currentStroke.rx = Math.abs(x - state.currentStroke.cx);
      state.currentStroke.ry = Math.abs(y - state.currentStroke.cy);
    },
    onEnd(x, y) {
      state.currentStroke.rx = Math.abs(x - state.currentStroke.cx);
      state.currentStroke.ry = Math.abs(y - state.currentStroke.cy);
      pushElement(state.currentStroke);
      state.socket.emit('draw-end', state.currentStroke);
      state.currentStroke = null;
      redrawAll();
    },
  },

  text: {
    cursor: 'text',
    onStart(x, y) {
      showTextInput(x, y);
    },
    onMove() {},
    onEnd() {},
  },

  eraser: {
    cursor: 'pointer',
    onStart(x, y) {
      // Find element near click and delete it
      const idx = findElementAt(x, y);
      if (idx !== -1) {
        state.socket.emit('erase-element', idx);
        state.elements.splice(idx, 1);
        redrawAll();
      }
    },
    onMove() {},
    onEnd() {},
  },
};

function findElementAt(x, y) {
  const threshold = 20;
  for (let i = state.elements.length - 1; i >= 0; i--) {
    const el = state.elements[i];
    if (el.type === 'rect' || el.type === 'line') {
      const bounds = getElementBounds(el);
      if (bounds && x >= bounds.x1 - threshold && x <= bounds.x2 + threshold &&
          y >= bounds.y1 - threshold && y <= bounds.y2 + threshold) {
        return i;
      }
    } else if (el.type === 'circle') {
      const dist = Math.hypot(x - el.cx, y - el.cy);
      if (dist <= Math.max(el.rx, el.ry) + threshold) return i;
    } else if (el.type === 'pen') {
      for (const pt of el.points) {
        if (Math.hypot(x - pt.x, y - pt.y) < threshold) return i;
      }
    } else if (el.type === 'text') {
      if (x >= el.x - threshold && x <= el.x + 100 + threshold &&
          y >= el.y - 20 - threshold && y <= el.y + threshold) {
        return i;
      }
    }
  }
  return -1;
}

function getElementBounds(el) {
  if (el.type === 'rect') {
    return {
      x1: Math.min(el.x, el.x + el.w),
      y1: Math.min(el.y, el.y + el.h),
      x2: Math.max(el.x, el.x + el.w),
      y2: Math.max(el.y, el.y + el.h),
    };
  }
  if (el.type === 'line') {
    return {
      x1: Math.min(el.x1, el.x2),
      y1: Math.min(el.y1, el.y2),
      x2: Math.max(el.x1, el.x2),
      y2: Math.max(el.y1, el.y2),
    };
  }
  return null;
}
