# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
yarn install

# Start dev server (Parcel, live reload at localhost:1234)
yarn start

# Production build
yarn build

# Lint
npx eslint src/
```

There are no tests in this project.

## Architecture

This is a single-page boids simulation rendered on an HTML5 Canvas, bundled with Parcel. All simulation logic lives in `src/index.mjs` (ES module).

### Simulation loop (`animate` in `index.mjs`)

Each frame:
1. Rebuilds a `QuadTree` covering the full canvas for O(n log n) neighbor lookups
2. Updates and draws `Predator` entities (hunt via quadtree, no flocking)
3. Inserts all living `Boid`s into the quadtree
4. For each `Boid`: queries nearby neighbors → `flock()` → `evade()` → `update()` → `draw()`
5. Draws geometric connection lines between nearby boids (capped at 7 lines per boid)
6. Runs the Reaper: removes dead boids and respawns replacements to maintain population

### Key classes

- **`Vector`** — 2D math with method chaining (`add`, `sub`, `mult`, `div`, `normalize`, `limit`, `dist`)
- **`QuadTree` / `Rectangle` / `Circle` / `Point`** — spatial partitioning; `QuadTree.query(range)` accepts either a `Circle` or `Rectangle`
- **`Boid`** — flocking agent with lifecycle (400–1000 frame lifespan), age-based hue (blue→red), opacity fade on death
- **`Predator`** — target-locking hunter; locks onto nearest boid, drops target if it dies or leaves perception radius

### Global `params` object

Slider values write directly into `params` (`separation`, `alignment`, `cohesion`, `radius`, `jitter`, `trails`, `showTree`). The `Boid.flock()` method reads from `params` every frame — no need to pass values in.

### Mouse / touch interaction

- Left click/hold: spawns boids (capped at 2000)
- Right click/hold: repulsor force field (radius 150)
- Mobile: 1 finger = repulsor, 2 fingers = spawner at midpoint

The controls panel uses `stopPropagation` on all pointer events to prevent UI interactions from triggering canvas behaviors.
