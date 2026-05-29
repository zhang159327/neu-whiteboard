// Geometry-based shape detection and correction (client-side)
const shapeTouchup = {
  // Douglas-Peucker point simplification
  simplify(points, epsilon) {
    if (points.length <= 2) return points;
    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0];
    const last = points[points.length - 1];
    const lineLen = Math.hypot(last.x - first.x, last.y - first.y);
    if (lineLen === 0) return [first];

    for (let i = 1; i < points.length - 1; i++) {
      const dist = this._perpendicularDist(points[i], first, last);
      if (dist > maxDist) { maxDist = dist; maxIdx = i; }
    }

    if (maxDist < epsilon) return [first, last];

    const left = this.simplify(points.slice(0, maxIdx + 1), epsilon);
    const right = this.simplify(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  },

  _perpendicularDist(p, a, b) {
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const ap = { x: p.x - a.x, y: p.y - a.y };
    const lenSq = ab.x * ab.x + ab.y * ab.y;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = (ap.x * ab.x + ap.y * ab.y) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + t * ab.x, y: a.y + t * ab.y };
    return Math.hypot(p.x - proj.x, p.y - proj.y);
  },

  _centroid(points) {
    let cx = 0, cy = 0;
    for (const p of points) { cx += p.x; cy += p.y; }
    return { x: cx / points.length, y: cy / points.length };
  },

  _isClosed(points) {
    if (points.length < 3) return false;
    const first = points[0];
    const last = points[points.length - 1];
    const dist = Math.hypot(last.x - first.x, last.y - first.y);
    const totalLen = this._pathLength(points);
    return totalLen > 0 && dist / totalLen < 0.15 && dist < 60;
  },

  _pathLength(points) {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return len;
  },

  _cornerAngles(vertices) {
    const n = vertices.length;
    if (n < 3) return [];
    const angles = [];
    for (let i = 0; i < n; i++) {
      const prev = vertices[(i - 1 + n) % n];
      const curr = vertices[i];
      const next = vertices[(i + 1) % n];
      angles.push(this._angleBetween(prev, curr, next));
    }
    return angles;
  },

  _angleBetween(a, b, c) {
    const ba = { x: a.x - b.x, y: a.y - b.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const dot = ba.x * bc.x + ba.y * bc.y;
    const cross = ba.x * bc.y - ba.y * bc.x;
    const magBa = Math.hypot(ba.x, ba.y);
    const magBc = Math.hypot(bc.x, bc.y);
    if (magBa === 0 || magBc === 0) return 180;
    const cos = Math.max(-1, Math.min(1, dot / (magBa * magBc)));
    return Math.acos(cos) * (180 / Math.PI);
  },

  tryCorrect(stroke) {
    if (stroke.type !== 'pen' || stroke.points.length < 5) return null;

    const simplified = this.simplify(stroke.points, 3);
    if (simplified.length < 2) return null;

    const closed = this._isClosed(simplified);
    const centroid = this._centroid(stroke.points);

    // Candidate: Line (2-3 simplified points, not closed)
    if (!closed && simplified.length <= 3 && simplified.length >= 2) {
      const first = simplified[0];
      const last = simplified[simplified.length - 1];
      const len = Math.hypot(last.x - first.x, last.y - first.y);
      if (len > 20) {
        const avgDev = this._avgDeviation(stroke.points, first, last);
        if (avgDev < 15) {
          return {
            type: 'line',
            x1: first.x, y1: first.y,
            x2: last.x, y2: last.y,
            color: stroke.color,
            strokeWidth: stroke.strokeWidth,
            _corrected: 'line',
          };
        }
      }
    }

    // Candidate: Rectangle (closed, ~4 corners with ~90° angles)
    if (closed && simplified.length >= 3 && simplified.length <= 8) {
      const hull = this._convexHull(simplified);
      const corners = this._findBestRect(hull, centroid);
      if (corners) {
        for (const c of corners) {
          const angles = this._cornerAngles(c);
          const allNear90 = angles.every(a => Math.abs(a - 90) < 35);
          if (allNear90) {
            const x = Math.min(c[0].x, c[2].x);
            const y = Math.min(c[0].y, c[2].y);
            const w = Math.abs(c[2].x - c[0].x);
            const h = Math.abs(c[2].y - c[0].y);
            if (w > 15 && h > 15 && w / h > 0.1 && w / h < 10) {
              return {
                type: 'rect', x, y, w, h,
                color: stroke.color,
                strokeWidth: stroke.strokeWidth,
                _corrected: 'rectangle',
              };
            }
          }
        }
      }
    }

    // Candidate: Circle (closed, many simplified points at ~constant radius)
    if (closed && simplified.length > 4) {
      const dists = stroke.points.map(p => Math.hypot(p.x - centroid.x, p.y - centroid.y));
      const avgR = dists.reduce((a, b) => a + b, 0) / dists.length;
      const variance = dists.reduce((s, d) => s + (d - avgR) * (d - avgR), 0) / dists.length;
      const stdDev = Math.sqrt(variance);
      if (avgR > 10 && stdDev / avgR < 0.3) {
        return {
          type: 'circle',
          cx: centroid.x, cy: centroid.y,
          rx: avgR, ry: avgR,
          color: stroke.color,
          strokeWidth: stroke.strokeWidth,
          _corrected: 'circle',
        };
      }
    }

    return null; // keep as freehand
  },

  _avgDeviation(points, a, b) {
    let sum = 0;
    for (const p of points) {
      sum += this._perpendicularDist(p, a, b);
    }
    return sum / points.length;
  },

  _convexHull(points) {
    const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length <= 2) return pts;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  },

  _findBestRect(hull, centroid) {
    if (hull.length < 4) return null;
    // Try all 4-vertex subsets of the hull
    const n = hull.length;
    if (n === 4) return [[...hull]];
    // Find the 4 extreme points
    let minX = hull[0], maxX = hull[0], minY = hull[0], maxY = hull[0];
    for (const p of hull) {
      if (p.x < minX.x) minX = p;
      if (p.x > maxX.x) maxX = p;
      if (p.y < minY.y) minY = p;
      if (p.y > maxY.y) maxY = p;
    }
    const corners = [minX, maxX, minY, maxY];
    const unique = [];
    const seen = new Set();
    for (const c of corners) {
      const key = `${c.x},${c.y}`;
      if (!seen.has(key)) { seen.add(key); unique.push(c); }
    }
    if (unique.length >= 4) return [unique.slice(0, 4)];
    return null;
  },
};
