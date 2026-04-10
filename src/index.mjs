// --- 1. GLOBAL PARAMETERS ---
// These update in real-time when sliders move
const defaultParams = {
  separation: 1.5,
  alignment: 1.5,
  cohesion: 1.0,
  radius: 50,
  jitter: 0.2,
  trails: false,
};

const params = { ...defaultParams };

// --- NEW: MOUSE STATE & LISTENERS ---
const mouse = { x: 0, y: 0, isLeftDown: false, isRightDown: false };

window.addEventListener("mousedown", (e) => {
  if (e.button === 0) mouse.isLeftDown = true; // Left click
  if (e.button === 2) mouse.isRightDown = true; // Right click
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouse.isLeftDown = false;
  if (e.button === 2) mouse.isRightDown = false;
});

window.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

// Prevent the default right-click menu from popping up
window.addEventListener("contextmenu", (e) => e.preventDefault());

// --- NEW: MOBILE TOUCH SUPPORT ---
// We target the canvas specifically, and use { passive: false } so we can
// prevent the browser from trying to scroll or zoom when you pinch/swipe.

window.addEventListener("touchstart", handleTouch, { passive: false });
window.addEventListener("touchmove", handleTouch, { passive: false });
window.addEventListener("touchend", handleTouchEnd, { passive: false });
window.addEventListener("touchcancel", handleTouchEnd, { passive: false });

function handleTouch(e) {
  e.preventDefault(); // Stops the screen from scrolling

  if (e.touches.length === 1) {
    // ONE FINGER: The Repulsor (Right Click)
    mouse.x = e.touches[0].clientX;
    mouse.y = e.touches[0].clientY;
    mouse.isRightDown = true;
    mouse.isLeftDown = false;
  } else if (e.touches.length >= 2) {
    // TWO FINGERS: The Spawner (Left Click)
    // Bonus UX: Calculate the exact midpoint between your two fingers and spawn them there!
    mouse.x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    mouse.y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    mouse.isLeftDown = true;
    mouse.isRightDown = false;
  }
}

function handleTouchEnd(e) {
  e.preventDefault();

  if (e.touches.length === 0) {
    // Zero fingers touching: turn everything off
    mouse.isLeftDown = false;
    mouse.isRightDown = false;
  } else if (e.touches.length === 1) {
    // If you were holding two fingers and lifted one, instantly switch back to Repulsor mode
    mouse.x = e.touches[0].clientX;
    mouse.y = e.touches[0].clientY;
    mouse.isRightDown = true;
    mouse.isLeftDown = false;
  }
}

// --- 2. VECTOR MATH ---
class Vector {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  add(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }
  mult(n) {
    this.x *= n;
    this.y *= n;
    return this;
  }
  div(n) {
    // Prevent dividing by zero, which would turn our coordinates into 'NaN' and break the universe
    if (n !== 0) {
      this.x /= n;
      this.y /= n;
    }
    return this; // Returning 'this' allows for method chaining!
  }
  mag() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  normalize() {
    let m = this.mag();
    if (m > 0) this.mult(1 / m);
    return this;
  }
  limit(max) {
    if (this.mag() > max) {
      this.normalize();
      this.mult(max);
    }
    return this;
  }
  static dist(v1, v2) {
    return Math.sqrt((v1.x - v2.x) ** 2 + (v1.y - v2.y) ** 2);
  }
}

// --- QUADTREE GEOMETRY ---
class Point {
  constructor(x, y, userData) {
    this.x = x;
    this.y = y;
    this.userData = userData; // This will hold the actual Boid object
  }
}

class Rectangle {
  constructor(x, y, w, h) {
    this.x = x; // Center X
    this.y = y; // Center Y
    this.w = w; // Half-width
    this.h = h; // Half-height
  }

  contains(item) {
    // Handle both raw coordinates AND our Boids
    let px = item.position ? item.position.x : item.x;
    let py = item.position ? item.position.y : item.y;

    return (
      px >= this.x - this.w &&
      px < this.x + this.w &&
      py >= this.y - this.h &&
      py < this.y + this.h
    );
  }

  intersects(range) {
    // Range can be a Circle or Rectangle. Let's handle a simple AABB collision check.
    // For our boid query, we'll pass a Circle, but approximate it as a Rectangle for the tree bounds check to keep math fast.
    let xDist = Math.abs(range.x - this.x);
    let yDist = Math.abs(range.y - this.y);

    let r = range.r || range.w; // Support both Circle (r) and Rectangle (w)

    if (xDist > this.w + r) return false;
    if (yDist > this.h + r) return false;
    if (xDist <= this.w) return true;
    if (yDist <= this.h) return true;

    let cornersq = Math.pow(xDist - this.w, 2) + Math.pow(yDist - this.h, 2);
    return cornersq <= Math.pow(r, 2);
  }
}

class Circle {
  constructor(x, y, r) {
    this.x = x;
    this.y = y;
    this.r = r;
  }

  contains(item) {
    let px = item.position ? item.position.x : item.x;
    let py = item.position ? item.position.y : item.y;

    let d = Math.pow(px - this.x, 2) + Math.pow(py - this.y, 2);
    return d <= Math.pow(this.r, 2);
  }
}

// --- THE QUADTREE ---
class QuadTree {
  constructor(boundary, capacity) {
    this.boundary = boundary; // Rectangle
    this.capacity = capacity;
    this.points = [];
    this.divided = false;
  }

  subdivide() {
    let x = this.boundary.x;
    let y = this.boundary.y;
    let w = this.boundary.w;
    let h = this.boundary.h;

    let ne = new Rectangle(x + w / 2, y - h / 2, w / 2, h / 2);
    this.northeast = new QuadTree(ne, this.capacity);
    let nw = new Rectangle(x - w / 2, y - h / 2, w / 2, h / 2);
    this.northwest = new QuadTree(nw, this.capacity);
    let se = new Rectangle(x + w / 2, y + h / 2, w / 2, h / 2);
    this.southeast = new QuadTree(se, this.capacity);
    let sw = new Rectangle(x - w / 2, y + h / 2, w / 2, h / 2);
    this.southwest = new QuadTree(sw, this.capacity);

    this.divided = true;
  }

  insert(point) {
    if (!this.boundary.contains(point)) return false;

    if (this.points.length < this.capacity) {
      this.points.push(point);
      return true;
    }

    if (!this.divided) this.subdivide();

    if (this.northeast.insert(point)) return true;
    if (this.northwest.insert(point)) return true;
    if (this.southeast.insert(point)) return true;
    if (this.southwest.insert(point)) return true;
  }

  query(range, found = []) {
    if (!this.boundary.intersects(range)) {
      return found; // Empty array if range doesn't intersect this quadrant
    }

    for (let p of this.points) {
      if (range.contains(p)) {
        found.push(p); // Push the actual Boid, not just the Point!
      }
    }

    if (this.divided) {
      this.northwest.query(range, found);
      this.northeast.query(range, found);
      this.southwest.query(range, found);
      this.southeast.query(range, found);
    }

    return found;
  }
  // --- NEW: VISUALIZE THE TREE ---
  draw(ctx) {
    // Draw the boundary of this specific quadrant
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)"; // Faint glass-like lines
    ctx.lineWidth = 1;
    ctx.strokeRect(
      this.boundary.x - this.boundary.w,
      this.boundary.y - this.boundary.h,
      this.boundary.w * 2,
      this.boundary.h * 2
    );

    // If it split, tell the children to draw themselves too!
    if (this.divided) {
      this.northeast.draw(ctx);
      this.northwest.draw(ctx);
      this.southeast.draw(ctx);
      this.southwest.draw(ctx);
    }
  }
}

// --- THE APEX PREDATOR (Upgraded AI) ---
class Predator {
  constructor(x, y) {
    this.position = new Vector(x, y);
    this.velocity = new Vector(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10
    );
    this.acceleration = new Vector(0, 0);

    // Predators need to be faster and turn sharper than panicking boids!
    this.maxSpeed = 5.0;
    this.maxForce = 0.8;

    this.perceptionRadius = 200; // Increased range so they spot prey sooner
    this.size = 5;

    // --- NEW: TARGET LOCKING ---
    this.target = null;
  }

  hunt(qtree, flock) {
    if (this.target) {
      let d = Vector.dist(this.position, this.target.position);

      // 3. GHOST CHECK: Drop the target if it gets deleted by the FIFO cap!
      if (
        this.target.isDead ||
        d > this.perceptionRadius ||
        !flock.includes(this.target)
      ) {
        this.target = null;
      }
    }

    if (!this.target) {
      let range = new Circle(
        this.position.x,
        this.position.y,
        this.perceptionRadius
      );
      let localBoids = qtree.query(range);
      let record = Infinity;

      for (let boid of localBoids) {
        // Simplify the distance math to guarantee no bugs
        let d = Vector.dist(this.position, boid.position);
        if (d < record) {
          record = d;
          this.target = boid;
        }
      }
    }

    if (this.target) {
      let desired = new Vector(
        this.target.position.x,
        this.target.position.y
      ).sub(this.position);
      desired.normalize().mult(this.maxSpeed);

      let steer = new Vector(desired.x, desired.y).sub(this.velocity);
      steer.limit(this.maxForce);
      this.acceleration.add(steer);
    }
  }

  update(width, height) {
    this.velocity.add(this.acceleration);
    this.velocity.limit(this.maxSpeed);
    this.position.add(this.velocity);
    this.acceleration.mult(0);

    // Screen wrap
    if (this.position.x > width) this.position.x = 0;
    if (this.position.x < 0) this.position.x = width;
    if (this.position.y > height) this.position.y = 0;
    if (this.position.y < 0) this.position.y = height;
  }

  draw(ctx) {
    // --- NEW: DRAW TARGET LASER ---
    if (this.target) {
      ctx.beginPath();
      ctx.moveTo(this.position.x, this.position.y);
      ctx.lineTo(this.target.position.x, this.target.position.y);
      ctx.strokeStyle = "rgba(255, 50, 50, 0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw the core
    ctx.beginPath();
    ctx.arc(this.position.x, this.position.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = "rgb(255, 50, 50)";
    ctx.fill();

    // Draw the danger aura
    ctx.beginPath();
    ctx.arc(this.position.x, this.position.y, this.size * 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 50, 50, 0.15)";
    ctx.fill();
  }
}
// --- 3. THE ABSTRACT BOID ---
class Boid {
  constructor(x, y) {
    this.position = new Vector(x, y);
    this.velocity = new Vector(
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 4
    );
    this.acceleration = new Vector(0, 0);
    this.maxSpeed = 2.5;
    this.maxForce = 0.05;
    this.hue = 0;
    // --- NEW: LIFECYCLE PROPERTIES ---
    // Give them a random lifespan between 400 and 1000 frames
    this.maxLife = Math.floor(Math.random() * 600) + 400;
    this.life = this.maxLife;
    this.opacity = 1.0;
    this.isDead = false;
  }

  flock(localBoids) {
    // Read from our global params object!
    let perceptionRadius = params.radius;
    let alignment = new Vector(0, 0);
    let cohesion = new Vector(0, 0);
    let separation = new Vector(0, 0);
    let total = 0;

    // --- NEW: THE NEIGHBOR CAP ---
    let maxNeighbors = 20; // Ignore anything past 20 boids

    for (let other of localBoids) {
      if (other === this) continue;
      let d = Vector.dist(this.position, other.position);
      if (other !== this && d < perceptionRadius) {
        alignment.add(other.velocity);
        cohesion.add(other.position);
        let diff = new Vector(this.position.x, this.position.y).sub(
          other.position
        );
        diff.mult(1 / d);
        separation.add(diff);
        total++;
        if (total >= maxNeighbors) break;
      }
    }

    if (total > 0) {
      alignment
        .mult(1 / total)
        .normalize()
        .mult(this.maxSpeed)
        .sub(this.velocity)
        .limit(this.maxForce);
      cohesion
        .mult(1 / total)
        .sub(this.position)
        .normalize()
        .mult(this.maxSpeed)
        .sub(this.velocity)
        .limit(this.maxForce);
      separation
        .mult(1 / total)
        .normalize()
        .mult(this.maxSpeed)
        .sub(this.velocity)
        .limit(this.maxForce);
    }

    // Apply weights from our sliders
    this.acceleration.add(separation.mult(params.separation));
    this.acceleration.add(alignment.mult(params.alignment));
    this.acceleration.add(cohesion.mult(params.cohesion));

    // --- NEW: THE CHAOS IMPULSE ---
    // Create a random vector pointing in any direction (-1 to 1)
    let randomNudge = new Vector(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    );
    // Multiply it by the slider value and add it to the steering forces
    this.acceleration.add(randomNudge.mult(params.jitter));
  }

  // --- NEW: EVASION LOGIC ---
  evade(predators) {
    let steer = new Vector(0, 0);
    let count = 0;
    let panicRadius = 80; // How close a predator has to be to trigger panic

    for (let p of predators) {
      let d = Vector.dist(this.position, p.position);

      if (d < panicRadius) {
        // Calculate vector pointing AWAY from the predator
        let diff = new Vector(this.position.x, this.position.y).sub(p.position);
        diff.normalize();
        diff.div(d); // The closer the predator, the harder they flee
        steer.add(diff);
        count++;
      }
    }

    if (count > 0) {
      steer.div(count);
      steer.normalize();
      steer.mult(this.maxSpeed * 1.5); // Panic speed! (50% faster than normal)
      steer.sub(this.velocity);
      steer.limit(this.maxForce * 2.5); // They can turn violently to escape
      this.acceleration.add(steer);
    }
  }

  update(width, height) {
    this.position.add(this.velocity);
    this.velocity.add(this.acceleration);
    this.velocity.limit(this.maxSpeed);
    this.acceleration.mult(0);

    // --- NEW: AGE-BASED COLOR MAPPING ---
    // Calculate how much life is left as a percentage (1.0 down to 0.0)
    let lifeRatio = this.life / this.maxLife;

    // Map that ratio to a hue between 240 (Blue) and 0 (Red)
    this.hue = lifeRatio * 300;

    if (this.position.x > width) this.position.x = 0;
    if (this.position.x < 0) this.position.x = width;
    if (this.position.y > height) this.position.y = 0;
    if (this.position.y < 0) this.position.y = height;

    // --- NEW: AGING LOGIC ---
    this.life--;

    // If they are in the last 100 frames of life, start fading out
    let fadeThreshold = 100;
    if (this.life < fadeThreshold) {
      this.opacity = Math.max(0, this.life / fadeThreshold);
    }

    // Mark as dead when life hits 0
    if (this.life <= 0) {
      this.isDead = true;
    }
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.position.x, this.position.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${this.hue}, 100%, 60%, ${this.opacity})`;
    ctx.fill();
  }
}

// --- 4. THE ENGINE & LOOP ---
const canvas = document.getElementById("boidsCanvas");
const ctx = canvas.getContext("2d");
let width, height;
const flock = [];
const predators = [];

const fpsDisplay = document.getElementById("fps-counter");
let lastFpsTime = 0;
let framesThisSecond = 0;
const boidCounterDisplay = document.getElementById("boid-counter");
let lastBoidCount = -1; // Keeps track of the population to prevent unnecessary DOM updates

function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

for (let i = 0; i < 150; i++) {
  flock.push(new Boid(Math.random() * width, Math.random() * height));
}

const sharedQueryCircle = new Circle(0, 0, 0);

function animate(timestamp) {
  // --- NEW: FPS CALCULATOR ---
  if (!lastFpsTime) lastFpsTime = timestamp;
  framesThisSecond++;

  const timeSinceLastUpdate = timestamp - lastFpsTime;

  // Update the UI only twice a second (every 500ms) to stop flickering
  if (timeSinceLastUpdate >= 500) {
    // Calculate the exact FPS based on elapsed time
    const fps = Math.round((framesThisSecond * 1000) / timeSinceLastUpdate);
    fpsDisplay.innerText = `${fps} FPS`;

    // Reset the counters
    framesThisSecond = 0;
    lastFpsTime = timestamp;
  }

  if (flock.length !== lastBoidCount) {
    boidCounterDisplay.innerText = `${flock.length} Boids`;
    lastBoidCount = flock.length;
  }

  let clearAlpha = params.trails ? 0.08 : 0.3;
  ctx.fillStyle = `rgba(5, 5, 5, ${clearAlpha})`;
  ctx.fillRect(0, 0, width, height);

  // --- NEW: REBUILD THE QUADTREE ---
  // 1. Create a bounding box covering the entire canvas
  let boundary = new Rectangle(width / 2, height / 2, width / 2, height / 2);
  // 2. Create the Quadtree with a capacity of 4
  let qtree = new QuadTree(boundary, 4);

  // --- NEW: UPDATE PREDATORS ---
  // Because there are usually only 1-3 predators, we don't need them in the tree.
  for (let p of predators) {
    p.hunt(qtree, flock); // Pass 'flock' so it can check for ghosts!
    p.update(width, height);
    p.draw(ctx);
  }
  // 3. Insert every alive boid into the tree
  for (let boid of flock) {
    qtree.insert(boid);
  }

  // --- NEW: DRAW THE TREE ---
  if (params.showTree) {
    qtree.draw(ctx);
  }

  // ---------------------------------
  // 1. Spawning Boids (Left Click Hold)
  if (mouse.isLeftDown) {
    // Prevent the browser from crashing by capping the max population at 400
    let offsetX1 = (Math.random() - 0.5) * 30;
    let offsetY1 = (Math.random() - 0.5) * 30;
    let offsetX2 = (Math.random() - 0.5) * 30;
    let offsetY2 = (Math.random() - 0.5) * 30;

    flock.push(new Boid(mouse.x + offsetX1, mouse.y + offsetY1));
    flock.push(new Boid(mouse.x + offsetX2, mouse.y + offsetY2));
    while (flock.length > 2000) {
      flock.shift();
    }
  }
  // 2. The Repulsor Force (Right Click Hold)
  if (mouse.isRightDown) {
    let mouseVec = new Vector(mouse.x, mouse.y);
    let repelRadius = 150;
    let repelForce = 0.5; // How hard it pushes them away

    // Draw a faint red glow to show the forcefield is active
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, repelRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 50, 50, 0.05)";
    ctx.fill();

    // Apply the force to nearby boids
    for (let boid of flock) {
      let d = Vector.dist(boid.position, mouseVec);
      if (d < repelRadius) {
        // Create a vector pointing FROM the mouse TO the boid
        let push = new Vector(boid.position.x, boid.position.y).sub(mouseVec);

        // The closer they are to the center, the harder they get pushed
        let forceMultiplier = (repelRadius - d) / repelRadius;
        push.normalize().mult(repelForce * forceMultiplier);

        // Add the explosion force directly to their acceleration
        boid.acceleration.add(push);
      }
    }
  }

  // Update Boids
  for (let boid of flock) {
    // Reuse the single memory object
    sharedQueryCircle.x = boid.position.x;
    sharedQueryCircle.y = boid.position.y;
    sharedQueryCircle.r = params.radius;

    // Pass the shared circle into the query
    let localBoids = qtree.query(sharedQueryCircle);

    boid.flock(localBoids);
    boid.evade(predators);
    boid.update(width, height);
    boid.draw(ctx);
  }

  // Geometric Connections
  for (let boid of flock) {
    sharedQueryCircle.x = boid.position.x;
    sharedQueryCircle.y = boid.position.y;
    sharedQueryCircle.r = params.radius;

    let localBoids = qtree.query(sharedQueryCircle);

    // --- NEW: THE RENDER CAP ---
    let linesDrawn = 0;
    let maxLines = 7; // Only draw lines to 5 neighbors max

    for (let neighbor of localBoids) {
      if (boid !== neighbor) {
        let d = Vector.dist(boid.position, neighbor.position);
        if (d < params.radius) {
          let boidAlpha = Math.min(boid.opacity, neighbor.opacity);
          let lineAlpha = (1 - d / params.radius) * boidAlpha;

          ctx.beginPath();
          ctx.moveTo(boid.position.x, boid.position.y);
          ctx.lineTo(neighbor.position.x, neighbor.position.y);
          ctx.strokeStyle = `hsla(${boid.hue}, 100%, 60%, ${lineAlpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
          linesDrawn++;
          // Stop drawing once this boid has enough connections!
          if (linesDrawn >= maxLines) break;
        }
      }
    }
  }

  // --- NEW: THE REAPER (Cleanup & Rebirth) ---
  for (let i = flock.length - 1; i >= 0; i--) {
    if (flock[i].isDead) {
      // Remove the dead boid
      flock.splice(i, 1);

      // Re-spawn a new baby boid to keep the population stable!
      flock.push(new Boid(Math.random() * width, Math.random() * height));
    }
  }

  requestAnimationFrame(animate);
}

animate();

// --- 5. UI CONTROLS LOGIC ---
function setupUI() {
  const panel = document.getElementById("controls-panel");
  const header = document.getElementById("controls-header");

  // ==========================================
  // 1. ISOLATE THE PANEL FROM THE CANVAS
  // ==========================================
  // This loops through every type of click/touch and tells the panel to
  // swallow it so you don't accidentally spawn boids while using sliders.
  const stopEvents = [
    "mousedown",
    "mouseup",
    "click",
    "contextmenu",
    "touchstart",
    "touchmove",
    "touchend",
    "pointerdown",
  ];
  stopEvents.forEach((eventType) => {
    panel.addEventListener(
      eventType,
      (e) => {
        e.stopPropagation();
      },
      { passive: false }
    );
  });

  // ==========================================
  // 2. THE COLLAPSE TOGGLE
  // ==========================================
  // Thanks to the 'touch-action: none' in the CSS, a standard 'click'
  // will now fire instantly on both desktop and mobile.
  header.addEventListener("click", () => {
    panel.classList.toggle("collapsed");
  });

  // ==========================================
  // 3. SLIDER BINDINGS
  // ==========================================
  const bindings = [
    { id: "sep", key: "separation" },
    { id: "ali", key: "alignment" },
    { id: "coh", key: "cohesion" },
    { id: "rad", key: "radius" },
    { id: "jit", key: "jitter" },
  ];

  bindings.forEach((bind) => {
    const slider = document.getElementById(`${bind.id}-slider`);
    const valueDisplay = document.getElementById(`${bind.id}-val`);

    if (!slider || !valueDisplay) return;

    slider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      params[bind.key] = val;
      valueDisplay.innerText = val.toFixed(bind.id === "rad" ? 0 : 1);
    });
  });

  const trailCheckbox = document.getElementById("trail-checkbox");
  if (trailCheckbox) {
    trailCheckbox.addEventListener("change", (e) => {
      params.trails = e.target.checked;
    });
  }

  const treeCheckbox = document.getElementById("tree-checkbox");
  if (treeCheckbox) {
    treeCheckbox.addEventListener("change", (e) => {
      params.showTree = e.target.checked;
    });
  }

  // ==========================================
  // 4. GLOBAL TOOLTIPS
  // ==========================================
  const globalTooltip = document.createElement("div");
  globalTooltip.id = "global-tooltip";
  document.body.appendChild(globalTooltip);

  const tooltipContainers = document.querySelectorAll(".tooltip-container");

  tooltipContainers.forEach((container) => {
    container.addEventListener("mouseenter", (e) => {
      globalTooltip.innerText = container.getAttribute("data-tooltip");

      const rect = container.getBoundingClientRect();
      const tooltipWidth = globalTooltip.offsetWidth || 200; // Fallback width

      let idealLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
      let maxRight = window.innerWidth - tooltipWidth - 10;
      let safeLeft = Math.max(10, Math.min(idealLeft, maxRight));

      globalTooltip.style.left = safeLeft + "px";
      globalTooltip.style.top = rect.top - 10 + "px";
      globalTooltip.classList.add("visible");
    });

    container.addEventListener("mouseleave", () => {
      globalTooltip.classList.remove("visible");
    });
  });

  const resetBtn = document.getElementById("reset-btn");

  resetBtn.addEventListener("click", () => {
    // 1. Overwrite the active params with the default params
    Object.assign(params, defaultParams);

    // 2. Loop through the sliders and physically move them back
    bindings.forEach((bind) => {
      const slider = document.getElementById(`${bind.id}-slider`);
      const valueDisplay = document.getElementById(`${bind.id}-val`);

      if (slider && valueDisplay) {
        slider.value = params[bind.key]; // Move the slider nub
        valueDisplay.innerText = params[bind.key].toFixed(
          bind.id === "rad" ? 0 : 1
        ); // Update the text
      }
      if (treeCheckbox) {
        treeCheckbox.checked = false;
      }
      if (trailCheckbox) trailCheckbox.checked = false;
    });
  });

  const predatorBtn = document.getElementById("predator-btn");
  if (predatorBtn) {
    predatorBtn.addEventListener("click", () => {
      // Drop a predator right in the middle of the screen
      predators.push(new Predator(canvas.width / 2, canvas.height / 2));

      // Cap it at 5 predators so things don't get entirely out of hand
      if (predators.length > 5) predators.shift();
    });
  }
}

// Initialize everything!
setupUI();
