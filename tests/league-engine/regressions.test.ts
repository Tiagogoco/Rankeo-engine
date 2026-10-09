import { describe, expect, it } from "vitest";
import { calculateMovements, autoAssignLevels } from "../../src/league-engine/index.js";

const scores = (points: number[]) => points.map((roundScore, index) => ({ entityId: `p${index}`, roundScore, seasonTotal: roundScore }));

describe("league movement regressions", () => {
  it.each([[10, 10, 10, 2], [10, 2, 2, 2]])("includes all three tied players for %j", (...points) => {
    const result = calculateMovements(scores(points), 2, 3);
    const pending = result.filter((movement) => movement.direction === "tie_pending");
    expect(pending).toHaveLength(3);
    const expectedIds = points[0] === points[1] ? ["p0", "p1", "p2"] : ["p1", "p2", "p3"];
    expect(pending.map((movement) => movement.entityId)).toEqual(expectedIds);
  });

  it("keeps a triple top tie at level one without requesting a promotion", () => {
    const result = calculateMovements(scores([10, 10, 10, 2]), 1, 3);
    expect(result.slice(0, 3).every((movement) => movement.direction === "none")).toBe(true);
  });

  it("keeps a triple bottom tie at the last level", () => {
    const result = calculateMovements(scores([10, 2, 2, 2]), 3, 3);
    expect(result.slice(1).every((movement) => movement.direction === "none")).toBe(true);
  });

  it("puts unknown categories after recognized categories", () => {
    const result = autoAssignLevels([
      { id: "unknown", category: "typo" }, { id: "a", category: "primera" },
      { id: "b", category: "segunda" }, { id: "missing", category: null },
    ], 2);
    expect(result.map((entry) => entry.entityId)).toEqual(["a", "b", "unknown", "missing"]);
    expect(result.find((entry) => entry.entityId === "unknown")?.level).toBe(2);
  });
});
