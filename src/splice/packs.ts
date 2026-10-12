import { createSearchRequest, SpliceSample, SpliceSamplePack, SpliceSearchRequest, SpliceSearchResponse } from "./api";

export function readSearchResponse<T = SpliceSample>(raw: string): SpliceSearchResponse<T>["data"]["assetsSearch"] {
  const response = JSON.parse(raw);
  if (response.errors?.length) {
    throw new Error(response.errors.map((error: { message: string }) => error.message).join("; "));
  }
  if (!response.data?.assetsSearch) throw new Error("Search returned no results data.");
  return response.data.assetsSearch;
}

/** Search every sample page so packs beyond the first 50 sounds aren't omitted.
 * Attribute filters describe the sounds inside a pack, not the pack itself.
 * The current-search guard stops pagination as soon as the user changes criteria.
 */
export async function findMatchingPacks(
  request: SpliceSearchRequest,
  search: (body: string) => Promise<string>,
  isCurrent: () => boolean,
  onProgress?: (page: number, totalPages: number) => void,
): Promise<SpliceSamplePack[]> {
  const samples = createSearchRequest("");
  samples.variables = { ...request.variables, filepath: "", query: undefined, page: 1 };
  const packs = new Map<string, SpliceSamplePack>();
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    if (!isCurrent()) return [];
    samples.variables.page = page;
    const data = readSearchResponse(await search(JSON.stringify(samples)));
    if (!isCurrent()) return [];
    totalPages = data.pagination_metadata.totalPages;
    onProgress?.(page, totalPages);
    for (const sample of data.items) {
      for (const pack of sample.parents.items) packs.set(pack.uuid, pack);
    }
  }
  const query = (request.variables.query ?? "").trim().toLowerCase();
  return [...packs.values()].filter(pack => pack.name.toLowerCase().includes(query));
}
