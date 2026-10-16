import { describe, expect, it } from "vitest";
import { downloadPack, packSamplePath } from "../src/splice/downloadPack";
import { createSearchRequest } from "../src/splice/api";
import { readSearchResponse } from "../src/splice/packs";
import { mockSearch } from "../src/dev/mock";

const sample = readSearchResponse(mockSearch(JSON.stringify(createSearchRequest("kick")))).items[0];
const pack = sample.parents.items[0];

describe("whole pack downloads", () => {
  it("downloads all pages regardless of browse filters and waits for pending file writes", async () => {
    const pages: number[] = [];
    const saved: string[] = [];
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let finished = false;
    const job = downloadPack(pack, async body => {
      const request = JSON.parse(body);
      expect(request.variables.filepath).toBe("");
      expect(request.variables.tags).toEqual([]);
      expect(request.variables.parent_asset_uuid).toBe(pack.uuid);
      expect(request.variables.bpm).toBeUndefined();
      pages.push(request.variables.page);
      request.variables.limit = 2;
      return mockSearch(JSON.stringify(request));
    }, async (sample, path) => { await waiting; saved.push(sample.uuid); expect(path).toMatch(/\.wav$/); }, () => {})
      .then(result => { finished = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(finished).toBe(false);
    expect(pages).toEqual([1]);
    release();
    const result = await job;
    expect(pages).toEqual([1, 2]);
    expect(new Set(saved).size).toBe(4);
    expect(result).toMatchObject({ saved: 4, failed: 0, found: 4 });
  });

  it("deduplicates repeated IDs, keeps conflicting names separate and reports failures", async () => {
    const paths: string[] = [];
    let active = 0, maximum = 0;
    const result = await downloadPack(pack, async () => JSON.stringify({ data: { assetsSearch: {
      items: [sample, sample, { ...sample, uuid: "other" }, { ...sample, uuid: "bad" }],
      pagination_metadata: { currentPage: 1, totalPages: 1 },
    } } }), async (item, path) => {
      active++; maximum = Math.max(maximum, active);
      try {
        paths.push(path);
        await Promise.resolve();
        if (item.uuid === "bad") throw Error("disk full");
      } finally { active--; }
    }, () => {});
    expect(maximum).toBeLessThanOrEqual(2);
    expect(new Set(paths).size).toBe(3);
    expect(result).toMatchObject({ found: 3, saved: 2, failed: 1 });
    expect(result.errors[0]).toContain("disk full");
  });

  it("rejects failed listing requests and empty packs", async () => {
    await expect(downloadPack(pack, async () => '{"errors":[{"message":"Network error"}]}', async () => {}, () => {})).rejects.toThrow("Network error");
    await expect(downloadPack(pack, async () => '{"data":{"assetsSearch":{"items":[],"pagination_metadata":{"totalPages":0}}}}', async () => {}, () => {})).rejects.toThrow("No samples");
  });

  it("keeps untrusted sample names inside the pack directory", () => {
    const path = packSamplePath({ ...pack, name: "../CON" }, { ...sample, name: "../../bad\\AUX.wav" });
    expect(path.split("/")).not.toContain("..");
    expect(path).toMatch(/bad\/_AUX\.wav$/);
  });
});
