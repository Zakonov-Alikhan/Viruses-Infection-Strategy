const PLAYER_IDS = ["X", "O"];

export function constrainDuelPosition(x, y, width, height, radius) {
  if (!(width > 0) || !(height > 0) || !(radius >= 0)) {
    return { x: clamp(Number.isFinite(x) ? x : 0.5, 0, 1), y: clamp(Number.isFinite(y) ? y : 0.5, 0, 1) };
  }
  const padding = radius * 1.42;
  const rx = Math.max(1, width / 2 - padding) / width;
  const ry = Math.max(1, height / 2 - padding) / height;
  const dx = (x - 0.5) / rx;
  const dy = (y - 0.5) / ry;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1) return { x, y };
  return { x: 0.5 + dx / distance * rx, y: 0.5 + dy / distance * ry };
}

export function createDuelDragState(body, point, pointerId, width, height) {
  return {
    pointerId,
    offsetX: body.x - point.x / width,
    offsetY: body.y - point.y / height,
    lastX: point.x,
    lastY: point.y,
    lastTime: point.time,
    vx: body.vx || 0,
    vy: body.vy || 0
  };
}

export function updateDuelDragState(drag, point, width, height, radius) {
  const elapsed = Math.max(1, point.time - drag.lastTime) / 1000;
  const target = constrainDuelPosition(
    point.x / width + drag.offsetX,
    point.y / height + drag.offsetY,
    width,
    height,
    radius
  );
  return {
    target,
    drag: {
      ...drag,
      lastX: point.x,
      lastY: point.y,
      lastTime: point.time,
      vx: clamp((point.x - drag.lastX) / width / elapsed, -0.5, 0.5),
      vy: clamp((point.y - drag.lastY) / height / elapsed, -0.5, 0.5)
    }
  };
}

export function releaseDuelBody(body, target, drag) {
  if (!body || !target) return body;
  body.x = target.x;
  body.y = target.y;
  if (drag) {
    body.vx = drag.vx;
    body.vy = drag.vy;
  }
  return body;
}

export function stepDuelPhysics(bodies, {
  width,
  height,
  radius,
  elapsedSeconds,
  timeMilliseconds,
  capturedPlayer = null,
  dragTarget = null
}) {
  if (!(width > 0) || !(height > 0) || !(radius > 0)) return;
  const dt = clamp(elapsedSeconds || 0, 0, 0.05);
  for (const player of PLAYER_IDS) {
    const body = bodies[player];
    if (player === capturedPlayer && dragTarget) {
      // Keep the body on the pointer's captured offset; collision resolution can still move its peer.
      body.x = dragTarget.x;
      body.y = dragTarget.y;
      continue;
    }
    if (!dt) continue;
    body.vx += Math.sin(timeMilliseconds * 0.00043 + body.phase) * 0.018 * dt;
    body.vy += Math.cos(timeMilliseconds * 0.00037 + body.phase * 1.3) * 0.018 * dt;
    const damping = Math.pow(0.91, dt);
    body.vx *= damping;
    body.vy *= damping;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    limitSpeed(body, width, height);
  }
  resolveDuelCollision(bodies.X, bodies.O, {
    width,
    height,
    radius,
    capturedPlayer
  });
}

export function resolveDuelCollision(first, second, {
  width,
  height,
  radius,
  capturedPlayer = null,
  restitution = 0.18
}) {
  if (!(width > 0) || !(height > 0) || !(radius > 0)) return false;
  let dx = (second.x - first.x) * width;
  let dy = (second.y - first.y) * height;
  let distance = Math.hypot(dx, dy);
  const minimumDistance = radius * 1.72;
  if (distance >= minimumDistance) return false;

  if (distance < 0.001) {
    // Stable direction for coincident centers; avoids NaN and frame-to-frame normal flips.
    dx = 1;
    dy = 0;
    distance = 1;
  }
  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minimumDistance - distance;
  const firstCaptured = capturedPlayer === "X";
  const secondCaptured = capturedPlayer === "O";
  const inverseFirst = firstCaptured ? 0 : 1;
  const inverseSecond = secondCaptured ? 0 : 1;
  const inverseTotal = inverseFirst + inverseSecond;

  if (inverseTotal > 0) {
    first.x -= (nx * overlap * inverseFirst / inverseTotal) / width;
    first.y -= (ny * overlap * inverseFirst / inverseTotal) / height;
    second.x += (nx * overlap * inverseSecond / inverseTotal) / width;
    second.y += (ny * overlap * inverseSecond / inverseTotal) / height;

    const relativeVelocityX = second.vx * width - first.vx * width;
    const relativeVelocityY = second.vy * height - first.vy * height;
    const alongNormal = relativeVelocityX * nx + relativeVelocityY * ny;
    if (alongNormal < 0) {
      const impulse = -(1 + restitution) * alongNormal / inverseTotal;
      first.vx -= impulse * inverseFirst * nx / width;
      first.vy -= impulse * inverseFirst * ny / height;
      second.vx += impulse * inverseSecond * nx / width;
      second.vy += impulse * inverseSecond * ny / height;
      limitSpeed(first, width, height);
      limitSpeed(second, width, height);
    }
  }
  return true;
}

function limitSpeed(body, width, height) {
  const velocityX = body.vx * width;
  const velocityY = body.vy * height;
  const speed = Math.hypot(velocityX, velocityY);
  const maximum = Math.max(width, height) * 0.48;
  if (speed <= maximum || speed === 0) return;
  const scale = maximum / speed;
  body.vx = velocityX * scale / width;
  body.vy = velocityY * scale / height;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
