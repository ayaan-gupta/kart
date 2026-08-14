import { solveAssignment } from '../assignment';

function totalCost(cost: number[][], pairs: [number, number][]): number {
  return pairs.reduce((sum, [r, c]) => sum + cost[r][c], 0);
}

describe('solveAssignment', () => {
  it('returns no pairs for an empty matrix', () => {
    expect(solveAssignment([])).toEqual([]);
    expect(solveAssignment([[]])).toEqual([]);
  });

  it('picks the only cell of a one by one matrix', () => {
    expect(solveAssignment([[5]])).toEqual([[0, 0]]);
  });

  it('finds the optimum where greedy would not', () => {
    // Greedy grabs the global minimum, 1 at (0,0), which strands row 1 on 100 for a total of
    // 101. The optimum pairs 2 with 2 for a total of 4. This is the crowded-cart case: two
    // tracks contending for the same detection.
    const cost = [
      [1, 2],
      [2, 100],
    ];
    const pairs = solveAssignment(cost);
    expect(pairs).toHaveLength(2);
    expect(totalCost(cost, pairs)).toBe(4);
  });

  it('solves the classic three by three case optimally', () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const pairs = solveAssignment(cost);
    expect(pairs).toHaveLength(3);
    expect(totalCost(cost, pairs)).toBe(5);
  });

  it('assigns every row when there are more columns than rows', () => {
    const cost = [
      [9, 1, 9, 9],
      [9, 9, 2, 9],
    ];
    const pairs = solveAssignment(cost);
    expect(pairs).toHaveLength(2);
    expect(totalCost(cost, pairs)).toBe(3);
    expect(new Set(pairs.map(([, c]) => c)).size).toBe(2);
  });

  it('assigns every column when there are more rows than columns', () => {
    const cost = [
      [9, 9],
      [1, 9],
      [9, 2],
    ];
    const pairs = solveAssignment(cost);
    expect(pairs).toHaveLength(2);
    expect(totalCost(cost, pairs)).toBe(3);
    expect(new Set(pairs.map(([r]) => r)).size).toBe(2);
  });

  it('never assigns a row or a column twice', () => {
    const cost = [
      [3, 3, 3],
      [3, 3, 3],
      [3, 3, 3],
    ];
    const pairs = solveAssignment(cost);
    expect(pairs).toHaveLength(3);
    expect(new Set(pairs.map(([r]) => r)).size).toBe(3);
    expect(new Set(pairs.map(([, c]) => c)).size).toBe(3);
  });

  it('handles negative costs', () => {
    const cost = [
      [-5, 0],
      [0, -3],
    ];
    expect(totalCost(cost, solveAssignment(cost))).toBe(-8);
  });
});
