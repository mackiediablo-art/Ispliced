import { describe, expect, it } from "vitest";
import { createPackSearchRequest, createSearchRequest, SpliceSamplePack } from "../src/splice/api";
import { findMatchingPacks, readSearchResponse } from "../src/splice/packs";
import { mockSearch } from "../src/dev/mock";

describe("pack search", () => {
  it("queries pack names rather than sample filenames", () => {
    const request = createPackSearchRequest("Neon Nights");
    expect(request.query).toContain("asset_type_slug: pack,");
    expect(request.variables.query).toBe("Neon Nights");
    expect(request.variables.filepath).toBe("");
    const data = readSearchResponse<SpliceSamplePack>(mockSearch(JSON.stringify(request)));
    expect(data.items.map(pack => pack.uuid)).toEqual(["pack-1"]);
  });

  it("applies combined audio filters and deduplicates packs across sample pages", async () => {
    const request = createPackSearchRequest("neon");
    request.variables.limit = 1; // Matching sounds span multiple pages in the same pack.
    request.variables.key = "C";
    request.variables.chord_type = "minor";
    request.variables.asset_category_slug = "loop";
    request.variables.min_bpm = 110;
    request.variables.max_bpm = 130;
    request.variables.tags = ["tag-4"]; // synth
    const packs = await findMatchingPacks(request, async body => mockSearch(body), () => true);
    expect(packs.map(pack => pack.uuid)).toEqual(["pack-1"]);

    delete request.variables.key;
    delete request.variables.chord_type;
    const pages: number[] = [];
    const multiple = await findMatchingPacks(request, async body => {
      const payload = JSON.parse(body);
      pages.push(payload.variables.page);
      expect(payload.variables.filepath).toBe("");
      expect(payload.variables.query).toBeUndefined();
      return mockSearch(body);
    }, () => true);
    expect(pages).toEqual([1, 2]);
    expect(multiple.map(pack => pack.uuid)).toEqual(["pack-1"]);
  });

  it("includes packs from later pages and supports exact BPM", async () => {
    const request = createPackSearchRequest("");
    request.variables.limit = 1;
    request.variables.asset_category_slug = "loop";
    const packs = await findMatchingPacks(request, async body => mockSearch(body), () => true);
    expect(packs.map(pack => pack.uuid).sort()).toEqual(["pack-1", "pack-2", "pack-3"]);
    request.variables.bpm = "140";
    expect((await findMatchingPacks(request, async body => mockSearch(body), () => true)).map(pack => pack.uuid))
      .toEqual(["pack-2"]);
  });

  it("opens a pack using its parent UUID with complete sample pagination", () => {
    const request = createSearchRequest("");
    request.variables.parent_asset_uuid = "pack-2";
    request.variables.parent_asset_type = "pack";
    request.variables.limit = 2;
    const data = readSearchResponse(mockSearch(JSON.stringify(request)));
    expect(data.pagination_metadata.totalPages).toBe(2);
    request.variables.page = 2;
    const second = readSearchResponse(mockSearch(JSON.stringify(request)));
    const samples = [...data.items, ...second.items];
    expect(samples).toHaveLength(4);
    expect(new Set(samples.map(sample => sample.uuid)).size).toBe(4);
    expect(samples.every(sample => sample.parents.items[0].uuid === "pack-2")).toBe(true);
  });

  it("stops scanning when a newer search replaces it", async () => {
    const request = createPackSearchRequest("");
    request.variables.limit = 1;
    let calls = 0;
    let current = true;
    const result = await findMatchingPacks(request, async body => {
      calls++;
      current = false;
      return mockSearch(body);
    }, () => current);
    expect(calls).toBe(1);
    expect(result).toEqual([]);
  });

  it("reports GraphQL errors, including HTTP-success error responses", () => {
    expect(() => readSearchResponse('{"errors":[{"message":"Invalid filter"}]}')).toThrow("Invalid filter");
    expect(() => readSearchResponse('{"data":null}')).toThrow("Search returned no results data");
  });
});
