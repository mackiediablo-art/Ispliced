import { describe, expect, it } from "vitest";
import { NavigationHistory } from "../src/ui/history";

describe("browse navigation history", () => {
  it("restores saved page and scroll in both directions", () => {
    const history = new NavigationHistory<{ page: number; scrollTop: number }>();
    history.push("packs:2", { page: 2, scrollTop: 0 });
    history.update({ page: 2, scrollTop: 150 });
    history.push("samples:1", { page: 1, scrollTop: 0 });
    expect(history.move(-1)).toEqual({ page: 2, scrollTop: 150 });
    expect(history.canBack).toBe(false);
    expect(history.canForward).toBe(true);
    expect(history.move(1)).toEqual({ page: 1, scrollTop: 0 });
    expect(history.move(1)).toBeUndefined();
  });

  it("keeps repeated renders out of history and discards forward navigation after a new search", () => {
    const history = new NavigationHistory<string>();
    history.push("a", "first search");
    expect(history.push("a", "first search")).toBe(false);
    history.push("b", "second search");
    history.move(-1);
    history.push("c", "new search");
    expect(history.canForward).toBe(false);
    expect(history.move(-1)).toBe("first search");
    expect(history.move(1)).toBe("new search");
  });
});
