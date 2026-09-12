export const computeLinearGridInfluence = (
  gridSize: number,
  selected: ReadonlySet<number>,
  locked: ReadonlySet<number>,
  gridHeight = gridSize,
): Float32Array => {
  const count = gridSize * gridHeight;
  const values = new Float32Array(count);
  if (selected.size === 0) return values;

  for (const sel of selected) {
    const cs = sel % gridSize;
    const rs = Math.floor(sel / gridSize);

    for (let r = 0; r < gridHeight; r += 1) {
      let cLeft = 0;
      for (let c = cs - 1; c >= 0; c -= 1) {
        if (locked.has(r * gridSize + c) || locked.has(rs * gridSize + c)) {
          cLeft = Math.max(cLeft, c);
          break;
        }
      }
      let cRight = gridSize - 1;
      for (let c = cs + 1; c < gridSize; c += 1) {
        if (locked.has(r * gridSize + c) || locked.has(rs * gridSize + c)) {
          cRight = Math.min(cRight, c);
          break;
        }
      }

      let rTop = 0;
      for (let tr = rs - 1; tr >= 0; tr -= 1) {
        if (locked.has(tr * gridSize + cs)) {
          rTop = tr;
          break;
        }
      }
      let rBottom = gridHeight - 1;
      for (let br = rs + 1; br < gridHeight; br += 1) {
        if (locked.has(br * gridSize + cs)) {
          rBottom = br;
          break;
        }
      }

      for (const l of locked) {
        const cl = l % gridSize;
        const rl = Math.floor(l / gridSize);
        if (cl > cs && rl < rs && r <= rl) cRight = Math.min(cRight, cl);
        if (cl < cs && rl < rs && r <= rl) cLeft = Math.max(cLeft, cl);
        if (cl > cs && rl > rs && r >= rl) cRight = Math.min(cRight, cl);
        if (cl < cs && rl > rs && r >= rl) cLeft = Math.max(cLeft, cl);
      }

      let infY = 0;
      if (r >= rTop && r <= rs) {
        infY = rs === rTop ? 1 : (r - rTop) / (rs - rTop);
      } else if (r >= rs && r <= rBottom) {
        infY = rs === rBottom ? 1 : (rBottom - r) / (rBottom - rs);
      }
      if (infY <= 0) continue;

      for (let c = 0; c < gridSize; c += 1) {
        let infX = 0;
        if (c >= cLeft && c <= cs) {
          infX = cs === cLeft ? 1 : (c - cLeft) / (cs - cLeft);
        } else if (c >= cs && c <= cRight) {
          infX = cs === cRight ? 1 : (cRight - c) / (cRight - cs);
        }
        if (infX <= 0) continue;

        const inf = infX * infY;
        const index = r * gridSize + c;
        if (inf > values[index]) values[index] = inf;
      }
    }
  }

  for (const l of locked) values[l] = 0;
  for (const s of selected) values[s] = 1;
  return values;
};
