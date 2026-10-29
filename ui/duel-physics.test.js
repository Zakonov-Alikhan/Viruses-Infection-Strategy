import assert from "node:assert/strict";
import test from "node:test";
import {
  createDuelDragState,
  releaseDuelBody,
  resolveDuelCollision,
  stepDuelPhysics,
  updateDuelDragState
} from "./duel-physics.js";

function pair({ x = 0.5, separation = 0.04, vx = 0, vy = 0 } = {}) {
  return {
    X: { x: x - separation / 2, y: 0.5, vx, vy, phase: 0.4 },
    O: { x: x + separation / 2, y: 0.5, vx: -vx, vy: -vy, phase: 2.1 }
  };
}

test("overlapping bacteria resolve penetration and an approaching collision reflects velocity", () => {
  const bodies = pair({ separation: 0.12, vx: 0.24 });
  const collided = resolveDuelCollision(bodies.X, bodies.O, { width: 500, height: 240, radius: 42 });
  assert.equal(collided, true);
  assert.ok((bodies.O.x - bodies.X.x) * 500 >= 42 * 1.72 - 0.01);
  assert.ok(bodies.X.vx < 0);
  assert.ok(bodies.O.vx > 0);
});

test("coincident centers are separated deterministically without non-finite or runaway velocities", () => {
  const bodies = pair({ separation: 0 });
  bodies.X.vx = 90;
  bodies.O.vx = -90;
  resolveDuelCollision(bodies.X, bodies.O, { width: 500, height: 240, radius: 42 });
  assert.ok(bodies.X.x < bodies.O.x);
  for (const body of Object.values(bodies)) {
    assert.ok(Number.isFinite(body.x) && Number.isFinite(body.y));
    assert.ok(Math.abs(body.vx) < 10 && Math.abs(body.vy) < 10);
  }
});

test("repeated simulation steps bound speed instead of accumulating unbounded acceleration", () => {
  const bodies = pair({ separation: 0.6 });
  for (let frame = 0; frame < 3000; frame += 1) {
    stepDuelPhysics(bodies, {
      width: 500, height: 240, radius: 42, elapsedSeconds: 0.05,
      timeMilliseconds: frame * 50
    });
  }
  for (const body of Object.values(bodies)) {
    assert.ok(Math.hypot(body.vx * 500, body.vy * 240) <= 500 * 0.48 + 0.01);
  }
});

test("the captured bacterium stays under its offset while collision pushes the other body away", () => {
  const bodies = pair({ x: 0.5, separation: 0.06 });
  const heldX = bodies.X.x;
  stepDuelPhysics(bodies, {
    width: 500, height: 240, radius: 42, elapsedSeconds: 0.016, timeMilliseconds: 1000,
    capturedPlayer: "X", dragTarget: { x: heldX, y: bodies.X.y }
  });
  assert.equal(bodies.X.x, heldX);
  assert.ok((bodies.O.x - bodies.X.x) * 500 >= 42 * 1.72 - 0.01);
});

test("dragging preserves the pointer-to-grab offset and release keeps the final position and momentum", () => {
  const body = { x: 0.4, y: 0.5, vx: 0, vy: 0 };
  let drag = createDuelDragState(body, { x: 180, y: 150, time: 100 }, 7, 400, 300);
  const moved = updateDuelDragState(drag, { x: 220, y: 180, time: 200 }, 400, 300, 30);
  drag = moved.drag;
  assert.ok(Math.abs((220 - moved.target.x * 400) - 20) < 0.01);
  assert.equal(moved.target.y, 0.6);
  releaseDuelBody(body, moved.target, drag);
  assert.deepEqual({ x: body.x, y: body.y }, moved.target);
  assert.equal(body.vx, 0.5);
  assert.equal(body.vy, 0.5);
});

test("drag targets remain inside the scene boundary even at extreme pointer positions", () => {
  const body = { x: 0.4, y: 0.5, vx: 0, vy: 0 };
  const drag = createDuelDragState(body, { x: 160, y: 150, time: 1 }, 1, 400, 300);
  const moved = updateDuelDragState(drag, { x: -1000, y: 3000, time: 100 }, 400, 300, 30);
  assert.ok(moved.target.x >= 0 && moved.target.x <= 1);
  assert.ok(moved.target.y >= 0 && moved.target.y <= 1);
});
