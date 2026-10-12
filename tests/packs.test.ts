import { describe, expect, it } from "vitest";
import { createPackSearchRequest, createSearchRequest, SpliceSamplePack } from "../src/splice/api";
import { findMatchingPacks, PackSearchCache, readSearchResponse } from "../src/splice/packs";
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

  it("returns the first page without scanning the catalogue", async () => {
    const request = createPackSearchRequest("");
    request.variables.asset_category_slug = "loop";
    let calls = 0;
    const result = await findMatchingPacks(request, async body => {
      calls++;
      const data = JSON.parse(mockSearch(body));
      data.data.assetsSearch.pagination_metadata.totalPages = 100000;
      return JSON.stringify(data);
    }, () => true);
    expect(calls).toBe(1);
    expect(result?.items.length).toBeGreaterThan(0);
    expect(result?.pagination_metadata.totalPages).toBe(100000);
  });

  it("applies combined audio filters and reuses cached sounds when the pack name changes", async () => {
    const request = createPackSearchRequest("neon");
    request.variables.limit = 1;
    request.variables.key = "C";
    request.variables.chord_type = "minor";
    request.variables.asset_category_slug = "loop";
    request.variables.min_bpm = 110;
    request.variables.max_bpm = 130;
    request.variables.tags = ["tag-4"];
    const cache: PackSearchCache = new Map();
    let calls = 0;
    const search = async (body: string) => { calls++; return mockSearch(body); };
    expect((await findMatchingPacks(request, search, () => true, cache))?.items.map(pack => pack.uuid)).toEqual(["pack-1"]);
    request.variables.query = "missing";
    expect((await findMatchingPacks(request, search, () => true, cache))?.items).toEqual([]);
    expect(calls).toBe(1);
  });

  it("loads later pages on demand, deduplicates parents and restores earlier results from cache", async () => {
    const request = createPackSearchRequest("");
    request.variables.limit = 1;
    request.variables.asset_category_slug = "loop";
    const cache: PackSearchCache = new Map();
    const fetched: number[] = [];
    const search = async (body: string) => {
      fetched.push(JSON.parse(body).variables.page);
      return mockSearch(body);
    };
    const first = await findMatchingPacks(request, search, () => true, cache);
    expect(first?.items.map(pack => pack.uuid)).toEqual(["pack-1"]);
    request.variables.page = 2;
    const second = await findMatchingPacks(request, search, () => true, cache);
    expect(second?.items.map(pack => pack.uuid)).toEqual(["pack-1", "pack-2"]);
    request.variables.page = 6;
    const all = await findMatchingPacks(request, search, () => true, cache);
    expect(all?.items.map(pack => pack.uuid).sort()).toEqual(["pack-1", "pack-2", "pack-3"]);
    request.variables.page = 1;
    expect((await findMatchingPacks(request, search, () => true, cache))?.items).toEqual(first?.items);
    expect(fetched).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("supports exact BPM and keeps different filters separate in cache", async () => {
    const request = createPackSearchRequest("");
    const cache: PackSearchCache = new Map();
    request.variables.bpm = "140";
    expect((await findMatchingPacks(request, async body => mockSearch(body), () => true, cache))?.items.map(pack => pack.uuid)).toEqual(["pack-2"]);
    request.variables.bpm = "120";
    expect((await findMatchingPacks(request, async body => mockSearch(body), () => true, cache))?.items.map(pack => pack.uuid)).toEqual(["pack-1"]);
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
    expect(result).toBeNull();
  });

  it("reports GraphQL errors, including HTTP-success error responses", () => {
    expect(() => readSearchResponse('{"errors":[{"message":"Invalid filter"}]}')).toThrow("Invalid filter");
    expect(() => readSearchResponse('{"data":null}')).toThrow("Search returned no results data");
  });
});
