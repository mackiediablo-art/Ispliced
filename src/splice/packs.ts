import { createSearchRequest, SpliceSample, SpliceSamplePack, SpliceSearchRequest, SpliceSearchResponse } from "./api";

export function readSearchResponse<T = SpliceSample>(raw: string): SpliceSearchResponse<T>["data"]["assetsSearch"] {
  const response = JSON.parse(raw);
  if (response.errors?.length) {
    throw new Error(response.errors.map((error: { message: string }) => error.message).join("; "));
  }
  if (!response.data?.assetsSearch) throw new Error("Search returned no results data.");
  return response.data.assetsSearch;
}

export type PackSearchPage = SpliceSearchResponse<SpliceSamplePack>["data"]["assetsSearch"];
export type PackSearchCache = Map<string, Map<number, PackSearchPage>>;

/** Fetch only the requested matching-sample page. Cache page chunks and combine
 * their parent packs, so discovery is incremental, deduplicated and reversible.
 * No catalogue-wide scan stands between a filter change and its first results.
 */
export async function findMatchingPacks(
  request: SpliceSearchRequest,
  search: (body: string) => Promise<string>,
  isCurrent: () => boolean,
  cache: PackSearchCache = new Map(),
): Promise<PackSearchPage | null> {
  const samples = createSearchRequest("");
  samples.variables = { ...request.variables, filepath: "", query: undefined, page: 1 };
  delete samples.variables.parent_asset_uuid;
  delete samples.variables.parent_asset_type;
  // Name filtering happens on parents. Changing just the pack name reuses sounds.
  const key = JSON.stringify({ ...samples.variables, page: undefined });
  let pages = cache.get(key);
  if (!pages) {
    pages = new Map();
    cache.set(key, pages);
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
  }
  const requestedPage = Math.max(1, request.variables.page ?? 1);
  let latest: PackSearchPage | undefined;
  const packs = new Map<string, SpliceSamplePack>();
  for (let page = 1; page <= requestedPage; page++) {
    if (!isCurrent()) return null;
    let chunk = pages.get(page);
    if (!chunk) {
      samples.variables.page = page;
      const data = readSearchResponse(await search(JSON.stringify(samples)));
      if (!isCurrent()) return null;
      chunk = { ...data, items: data.items.flatMap(sample => sample.parents.items) };
      pages.set(page, chunk);
    }
    latest = chunk;
    for (const pack of chunk.items) packs.set(pack.uuid, pack);
    if (page >= chunk.pagination_metadata.totalPages) break;
  }
  const query = (request.variables.query ?? "").trim().toLowerCase();
  const items = [...packs.values()].filter(pack => pack.name.toLowerCase().includes(query));
  return { ...latest!, items, response_metadata: { records: items.length } };
}
