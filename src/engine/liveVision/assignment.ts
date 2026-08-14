/**
 * Hungarian algorithm, shortest-augmenting-path form with dual potentials, O(n^2 m).
 *
 * Returns the set of `[row, column]` pairs whose costs sum to the minimum possible total.
 * Rectangular input is handled by padding to a square with zeros and discarding any pair
 * that lands on padding, which is valid because padded cells are identical in every column.
 */
export function solveAssignment(cost: number[][]): [number, number][] {
  const rows = cost.length;
  const cols = rows === 0 ? 0 : cost[0].length;
  if (rows === 0 || cols === 0) return [];

  const size = Math.max(rows, cols);
  const padded: number[][] = [];
  for (let i = 0; i < size; i += 1) {
    const row = new Array<number>(size).fill(0);
    if (i < rows) {
      for (let j = 0; j < cols; j += 1) row[j] = cost[i][j];
    }
    padded.push(row);
  }

  // One-based working arrays: index 0 is the algorithm's virtual starting column.
  const u = new Array<number>(size + 1).fill(0);
  const v = new Array<number>(size + 1).fill(0);
  const columnRow = new Array<number>(size + 1).fill(0);
  const way = new Array<number>(size + 1).fill(0);

  for (let i = 1; i <= size; i += 1) {
    columnRow[0] = i;
    let j0 = 0;
    const minv = new Array<number>(size + 1).fill(Infinity);
    const used = new Array<boolean>(size + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = columnRow[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= size; j += 1) {
        if (used[j]) continue;
        const cur = padded[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      if (delta === Infinity) {
        throw new Error(
          'solveAssignment: cost matrix has no feasible assignment (every remaining ' +
            'augmenting path is blocked by an infinite cost)',
        );
      }

      for (let j = 0; j <= size; j += 1) {
        if (used[j]) {
          u[columnRow[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (columnRow[j0] !== 0);

    do {
      const j1 = way[j0];
      columnRow[j0] = columnRow[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const pairs: [number, number][] = [];
  for (let j = 1; j <= size; j += 1) {
    const i = columnRow[j] - 1;
    if (i >= 0 && i < rows && j - 1 < cols) pairs.push([i, j - 1]);
  }
  return pairs.sort((a, b) => a[0] - b[0]);
}
