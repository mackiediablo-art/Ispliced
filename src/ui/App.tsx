import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Alert, AlertContent, AlertDescription, AlertIndicator, AlertTitle, Button, ListBox, ListBoxItem, ListBoxItemIndicator, ModalBackdrop, ModalCloseTrigger, ModalContainer, ModalDialog, Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationNextIcon, PaginationPrevious, PaginationPreviousIcon, ProgressCircle, ProgressCircleFillCircle, ProgressCircleTrack, ProgressCircleTrackCircle, ToggleButton, useOverlayState } from "@heroui/react";
import { InputGroup, InputGroupInput, InputGroupPrefix, InputGroupSuffix, Modal, Popover, PopoverContent, PopoverDialog, Select, SelectIndicator, SelectPopover, SelectTrigger, SelectValue } from "@heroui/react";
import { ArrowLeft, ArrowRight, ArrowUpDown, ChevronDown, Disc3, EllipsisVertical, Guitar, Layers, Metronome, MoveRight, Music2, Repeat, Search, Wrench, X } from "lucide-react";
import { emit, listen } from "@tauri-apps/api/event";
import { cfg } from "../config";
import { SpliceSample, SpliceSamplePack, SpliceSearchResponse, createSearchRequest, createPackSearchRequest } from "../splice/api";
import { ChordType, MusicKey, SpliceSampleType, SpliceSortBy, SpliceTag } from "../splice/entities";

import { findMatchingPacks, PackSearchCache, readSearchResponse } from "../splice/packs";
import { NavigationHistory } from "./history";
import PackCard from "./components/PackCard";
import SampleListEntry from "./components/SampleListEntry";
import SettingsModalContent from "./components/SettingsModalContent";
import UpdateModal from "./components/UpdateModal";
import { UpdateInfo, checkForUpdates } from "../updater";
import KeyScaleSelection from "./components/KeyScaleSelection";
import BpmSelection, { BpmFilter, BpmFilterType } from "./components/BpmSelection";
import { SamplePlaybackCancellation, SamplePlaybackContext } from "./playback";
import { IN_TAURI, checkDirExists } from "../native";
import { mockSearch } from "../dev/mock";
import { FIELD_BUTTON_CLASSES, NO_PRESS_SCALE, TAG_PILL_CLASSES } from "./fieldStyles";

/**
 * Runs a Splice GraphQL request through the hidden splice.com helper webview
 * (see `splice-helper` in the Rust backend), which fetches from the splice.com
 * origin so it clears Cloudflare Bot Management and Splice's CORS. Communication
 * is a one-shot event round-trip correlated by a request id.
 */
function spliceSearch(body: string): Promise<string> {
  if (!IN_TAURI) {
    return Promise.resolve(mockSearch(body));
  }

  const id = crypto.randomUUID();

  return new Promise<string>((resolve, reject) => {
    let unlisten: (() => void) | null = null;

    // Re-emit periodically: the helper webview may not have registered its
    // listener yet (it's still loading splice.com / clearing Cloudflare), and
    // Tauri drops events that have no listener rather than queuing them.
    const reEmit = setInterval(() => { emit("splice-search", { id, body }); }, 1500);

    const settle = () => { clearInterval(reEmit); clearTimeout(timer); unlisten?.(); };

    const timer = setTimeout(() => {
      settle();
      reject(new Error("Splice search timed out (the helper webview may still be clearing Cloudflare)."));
    }, 20000);

    listen<{ id: string, ok: boolean, body?: string, error?: string }>("splice-result", ev => {
      if (ev.payload.id !== id) return;

      settle();

      if (ev.payload.ok && ev.payload.body != null) {
        resolve(ev.payload.body);
      } else {
        reject(new Error(ev.payload.error ?? "Splice search failed"));
      }
    }).then(fn => {
      unlisten = fn;
      emit("splice-search", { id, body });
    });
  });
}

function buildPageList(current: number, total: number): (number | "ellipsis")[] {
  const pages: (number | "ellipsis")[] = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - current) <= 2) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== "ellipsis") {
      pages.push("ellipsis");
    }
  }
  return pages;
}

interface PackSearchState {
  query: string; sortBy: SpliceSortBy; bpm: BpmFilter | undefined;
  bpmType: BpmFilterType; sampleType: SpliceSampleType | "any";
  instruments: Set<string>; genres: Set<string>; tags: SpliceTag[];
  musicKey: MusicKey | null; chordType: ChordType | null; page: number; randomSeed: string;
}
interface BrowseSnapshot extends PackSearchState {
  view: "samples" | "packs";
  packFilter: SpliceSamplePack | null;
  scrollTop: number;
  returnToPacks: PackSearchState | null;
}

function App() {
  const settings = useOverlayState({
    defaultOpen: !cfg().configured
  });

  const [bpmType, setBpmType] = useState<BpmFilterType>("exact");
  const [bpm, setBpm] = useState<BpmFilter>();
  const [bpmOpen, setBpmOpen] = useState(false);

  const [view, setView] = useState<"samples" | "packs">("samples");
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [packs, setPacks] = useState<SpliceSamplePack[]>([]);
  const searchSequence = useRef(0);
  const [searchRevision, setSearchRevision] = useState(0);
  const restoredPage = useRef<number | null>(null);
  const randomSeed = useRef("");
  const matchingPacksCache = useRef<PackSearchCache>(new Map());
  const responseCache = useRef(new Map<string, string>());
  const pendingRequests = useRef(new Map<string, Promise<string>>());
  const facetsCache = useRef<SpliceSearchResponse["data"]["assetsSearch"] | null>(null);
  const navigation = useRef(new NavigationHistory<BrowseSnapshot>());
  const [, refreshNavigation] = useState(0);
  const restoringHistory = useRef(false);
  const pendingScroll = useRef<number | null>(null);

  const [results, setResults] = useState<SpliceSample[]>([]);
  const resultContainer = useRef<HTMLDivElement | null>(null);


  const [sortBy, setSortBy] = useState<SpliceSortBy>("popularity");
  const [sampleType, setSampleType] = useState<SpliceSampleType | "any">("any")

  const [knownInstruments, setKnownInstruments] = useState<{name: string, uuid: string}[]>([]);
  const [knownGenres, setKnownGenres] = useState<{name: string, uuid: string}[]>([]);

  const [instruments, setInstruments] = useState(new Set<string>([]));
  const [genres, setGenres] = useState(new Set<string>([]));
  const [tags, setTags] = useState<SpliceTag[]>([]);

  const [knownTags, setKnownTags] = useState<SpliceTag[]>([]);
  const [tagsExpanded, setTagsExpanded] = useState(false);

  const [musicKey, setMusicKey] = useState<MusicKey | null>(null);
  const [chordType, setChordType] = useState<ChordType | null>(null);

  const [packFilter, setPackFilter] = useState<SpliceSamplePack | null>(null);

  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  // Drags silently fail when the sample folder doesn't exist (e.g. it was deleted,
  // or lives on a drive that's been unplugged), so warn about it up front.
  const [sampleDirMissing, setSampleDirMissing] = useState(false);

  useEffect(() => {
    if (settings.isOpen)
      return; // re-check once the user is done changing settings

    const refresh = () => {
      checkDirExists(cfg().sampleDir)
        .then(exists => setSampleDirMissing(!exists))
        .catch(err => console.error("Failed to check the sample folder:", err));
    };

    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [settings.isOpen]);

  useEffect(() => {
    checkForUpdates()
      .then(setUpdate)
      .catch(err => console.error("Update check failed:", err));
  }, []);

  // Results should be visible not only when a text query is entered, but also
  // when the user is filtering solely by tags, key, BPM, etc.
  const filtersActive =
    tags.length > 0 || instruments.size > 0 || genres.size > 0 ||
    musicKey != null || chordType != null || bpm != null || sampleType != "any" ||
    packFilter != null;

  useEffect(() => {
    const timer = setTimeout(() => { setSearchQuery(query); setSearchRevision(value => value + 1); }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const previousCriteria = useRef("");
  useEffect(() => {
    const criteria = JSON.stringify([view, searchQuery, sortBy, bpm, bpmType, sampleType,
      [...instruments], [...genres], tags, musicKey, chordType, packFilter?.uuid]);
    const resetPage = previousCriteria.current !== criteria;
    previousCriteria.current = criteria;
    const restoring = restoredPage.current !== null;
    const page = restoredPage.current ?? (resetPage ? 1 : currentPage);
    restoredPage.current = null;
    if (resetPage && !restoring) randomSeed.current = Math.floor(Math.random() * 10000000000).toString();
    if (restoringHistory.current) {
      restoringHistory.current = false;
    } else {
      const previous = navigation.current.current;
      if (previous) navigation.current.update({ ...previous, scrollTop: resultContainer.current?.scrollTop ?? previous.scrollTop });
      const snapshot = captureBrowseState(page);
      if (navigation.current.push(JSON.stringify([criteria, page]), snapshot)) {
        pendingScroll.current = 0;
        refreshNavigation(value => value + 1);
      }
    }
    setCurrentPage(page);
    void updateSearch(searchQuery, page);
    return () => { searchSequence.current++; };
  }, [view, searchQuery, searchRevision, sortBy, bpm, bpmType, sampleType,
    instruments, genres, tags, currentPage, musicKey, chordType, packFilter]);

  const [smplCancellation, smplSetCancellation] = useState<SamplePlaybackCancellation | null>(null);
  const pbCtx: SamplePlaybackContext = {
    cancellation: smplCancellation,
    setCancellation: smplSetCancellation
  }

  // Stop any playing sample when the window loses focus (e.g. the user tabs
  // away or drags a sample into their DAW).
  useEffect(() => {
    const stopOnBlur = () => smplCancellation?.();
    window.addEventListener("blur", stopOnBlur);
    return () => window.removeEventListener("blur", stopOnBlur);
  }, [smplCancellation]);

  function changePage(n: number) {
    setCurrentPage(n);
    resultContainer.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }

  function handleSearchInput(ev: React.ChangeEvent<HTMLInputElement>) {
    // Invalidate pending responses immediately, before the debounce runs.
    searchSequence.current++;
    setSearchLoading(true);
    setQuery(ev.target.value);
  }

  function handleSearchKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key == "Enter") { setSearchQuery(query); setSearchRevision(value => value + 1); }
  }

  function toggleTag(tag: SpliceTag) {
    setTags(current => current.some(x => x.uuid == tag.uuid)
      ? current.filter(x => x.uuid != tag.uuid) : [...current, tag]);
  }

  function handleTagClick(tag: SpliceTag) {
    if (!tags.some(x => x.uuid == tag.uuid)) toggleTag(tag);
  }

  const packSearch = useRef<PackSearchState | null>(null);

  function captureBrowseState(page = currentPage): BrowseSnapshot {
    return { view, query: searchQuery, sortBy, bpm, bpmType, sampleType,
      instruments, genres, tags, musicKey, chordType, page,
      randomSeed: randomSeed.current, packFilter, scrollTop: 0, returnToPacks: packSearch.current };
  }

  function saveBrowseBeforeNavigation() {
    // Capture typed input too: a user can open a result before its debounce fires.
    const criteria = JSON.stringify([view, query, sortBy, bpm, bpmType, sampleType,
      [...instruments], [...genres], tags, musicKey, chordType, packFilter?.uuid]);
    const snapshot = { ...captureBrowseState(), query, scrollTop: resultContainer.current?.scrollTop ?? 0 };
    if (!navigation.current.push(JSON.stringify([criteria, currentPage]), snapshot)) navigation.current.update(snapshot);
    refreshNavigation(value => value + 1);
  }

  function rememberScroll() {
    const previous = navigation.current.current;
    if (previous && resultContainer.current) {
      navigation.current.update({ ...previous, scrollTop: resultContainer.current.scrollTop });
    }
  }

  function navigateHistory(direction: -1 | 1) {
    const history = navigation.current;
    const previous = history.current;
    if (previous) history.update({ ...previous, scrollTop: resultContainer.current?.scrollTop ?? previous.scrollTop });
    const saved = history.move(direction);
    if (!saved) return;
    searchSequence.current++;
    pbCtx.cancellation?.();
    restoringHistory.current = true;
    restoredPage.current = saved.page;
    pendingScroll.current = saved.scrollTop;
    randomSeed.current = saved.randomSeed;
    packSearch.current = saved.returnToPacks;
    setView(saved.view); setQuery(saved.query); setSearchQuery(saved.query);
    setSortBy(saved.sortBy); setBpm(saved.bpm); setBpmType(saved.bpmType);
    setSampleType(saved.sampleType); setInstruments(saved.instruments); setGenres(saved.genres);
    setTags(saved.tags); setMusicKey(saved.musicKey); setChordType(saved.chordType);
    setPackFilter(saved.packFilter); setCurrentPage(saved.page);
    setSearchRevision(value => value + 1);
    refreshNavigation(value => value + 1);
  }

  useLayoutEffect(() => {
    if (!searchLoading && pendingScroll.current !== null && resultContainer.current) {
      resultContainer.current.scrollTop = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [results, packs, searchLoading]);

  async function cachedSearch(body: string): Promise<string> {
    const cached = responseCache.current.get(body);
    if (cached) return cached;
    let pending = pendingRequests.current.get(body);
    if (!pending) {
      pending = spliceSearch(body).then(raw => {
        readSearchResponse(raw); // Don't retain failed GraphQL responses.
        responseCache.current.set(body, raw);
        if (responseCache.current.size > 64) responseCache.current.delete(responseCache.current.keys().next().value!);
        return raw;
      }).finally(() => pendingRequests.current.delete(body));
      pendingRequests.current.set(body, pending);
    }
    return pending;
  }

  function handlePackClick(pack: SpliceSamplePack) {
    saveBrowseBeforeNavigation();
    searchSequence.current++;
    pbCtx.cancellation?.();
    if (view === "packs") {
      packSearch.current = { query, sortBy, bpm, bpmType, sampleType,
        instruments, genres, tags, musicKey, chordType, page: currentPage, randomSeed: randomSeed.current };
    }
    // A pack opens with every sample, rather than inheriting the discovery filters.
    setQuery(""); setSearchQuery(""); setBpm(undefined); setMusicKey(null); setChordType(null);
    setInstruments(new Set()); setGenres(new Set()); setTags([]); setSampleType("any");
    setPackFilter(pack); setCurrentPage(1); setView("samples");
    setResults([]); setTotalPages(0);
  }

  function showPacks() {
    if (view === "packs") return;
    saveBrowseBeforeNavigation();
    searchSequence.current++;
    pbCtx.cancellation?.();
    setPackFilter(null);
    const saved = packSearch.current;
    if (saved) {
      setQuery(saved.query); setSearchQuery(saved.query); setSortBy(saved.sortBy);
      setBpm(saved.bpm); setBpmType(saved.bpmType); setSampleType(saved.sampleType);
      setInstruments(saved.instruments); setGenres(saved.genres); setTags(saved.tags);
      setMusicKey(saved.musicKey); setChordType(saved.chordType);
      restoredPage.current = saved.page;
      randomSeed.current = saved.randomSeed;
      setCurrentPage(saved.page);
      packSearch.current = null;
    }
    setView("packs");
  }

  async function updateSearch(newQuery: string, page: number) {
    const sequence = ++searchSequence.current;
    const isCurrent = () => sequence === searchSequence.current;
    const payload = view === "packs" ? createPackSearchRequest(newQuery) : createSearchRequest(newQuery);
    payload.variables.sort = sortBy;
    if (sortBy == "random") {
      payload.variables.random_seed = randomSeed.current;
    }

    payload.variables.tags = tags.map(x => x.uuid);

    if (bpmType == "exact") {
      payload.variables.bpm = bpm?.bpm;
    } else {
      payload.variables.min_bpm = bpm?.minBpm;
      payload.variables.max_bpm = bpm?.maxBpm;
    }

    if (sampleType != "any") {
      payload.variables.asset_category_slug = sampleType;
    }

    payload.variables.tags.push(...instruments);
    payload.variables.tags.push(...genres);

    payload.variables.chord_type = chordType ?? undefined;
    payload.variables.key = musicKey ?? undefined;

    if (packFilter != null) {
      payload.variables.parent_asset_uuid = packFilter.uuid;
      payload.variables.parent_asset_type = "pack";
    }

    payload.variables.page = page;

    setSearchLoading(true);
    setSearchError(null);
    try {
      let data: SpliceSearchResponse<SpliceSample | SpliceSamplePack>["data"]["assetsSearch"];
      if (view === "packs" && filtersActive) {
        const matching = await findMatchingPacks(payload, cachedSearch, isCurrent, matchingPacksCache.current);
        if (!matching || !isCurrent()) return;
        data = matching;
        setPacks(matching.items);
        setTotalPages(matching.pagination_metadata.totalPages);
      } else {
        const raw = await cachedSearch(JSON.stringify(payload));
        data = view === "packs" ? readSearchResponse<SpliceSamplePack>(raw) : readSearchResponse<SpliceSample>(raw);
        if (!isCurrent()) return;
        if (view === "packs") setPacks(data.items as SpliceSamplePack[]);
        else setResults(data.items as SpliceSample[]);
        setTotalPages(data.pagination_metadata.totalPages);
        if (view === "samples" && !facetsCache.current) facetsCache.current = data as SpliceSearchResponse["data"]["assetsSearch"];
        if (view === "packs") {
          if (!facetsCache.current) {
            facetsCache.current = readSearchResponse(await cachedSearch(JSON.stringify(createSearchRequest(""))));
          }
          data = facetsCache.current;
        }
      }
      if (!isCurrent()) return;
      pbCtx.cancellation?.();

      function findConstraints(name: "Genre" | "Instrument") {
        return data.tag_summary.map(x => x.tag)
          .filter(x => x.taxonomy.name == name)
          .map(x => ({ name: x.label, uuid: x.uuid }));
      }
      setKnownGenres(findConstraints("Genre"));
      setKnownInstruments(findConstraints("Instrument"));
      const seenTags = new Set<string>();
      setKnownTags(
        [...data.tag_summary].sort((a, b) => b.count - a.count).map(x => x.tag)
          .filter(x => !seenTags.has(x.uuid) && (seenTags.add(x.uuid), true))
          .map(x => ({ uuid: x.uuid, label: x.label }))
      );
    } catch (err) {
      if (isCurrent()) setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrent()) setSearchLoading(false);
    }
  }

  const showResults = view === "packs" || query.length > 0 || filtersActive;
  const resultCount = view === "packs" ? packs.length : results.length;

  return (
    <main className="flex flex-col gap-2 h-screen p-6">
      <Modal isOpen={settings.isOpen} onOpenChange={settings.setOpen}>
        <ModalBackdrop isDismissable={false}>
          <ModalContainer size="lg">
            <ModalDialog className="max-h-full min-h-0">
              {cfg().configured && <ModalCloseTrigger />}
              <SettingsModalContent onClose={settings.close} />
            </ModalDialog>
          </ModalContainer>
        </ModalBackdrop>
      </Modal>

      { update != null &&
        <UpdateModal update={update} onDismiss={() => setUpdate(null)} />
      }

      <div className="flex items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-3">
          <div className="flex gap-1" aria-label="Navigation history">
            <Button isIconOnly variant="outline" aria-label="Go back"
              isDisabled={!navigation.current.canBack} onClick={() => navigateHistory(-1)}><ArrowLeft className="size-4" /></Button>
            <Button isIconOnly variant="outline" aria-label="Go forward"
              isDisabled={!navigation.current.canForward} onClick={() => navigateHistory(1)}><ArrowRight className="size-4" /></Button>
          </div>
          <h1 className="text-xl font-semibold">Ispliced</h1>
        </div>
        <nav aria-label="Browse library" className="flex gap-2">
          <Button variant={view === "samples" ? "primary" : "outline"}
            aria-current={view === "samples" ? "page" : undefined}
            onClick={() => { if (view === "samples") return; saveBrowseBeforeNavigation(); searchSequence.current++; pbCtx.cancellation?.(); setView("samples"); }}>Samples</Button>
          <Button variant={view === "packs" ? "primary" : "outline"}
            aria-current={view === "packs" ? "page" : undefined} onClick={showPacks}>Sample packs</Button>
        </nav>
      </div>

      <div className="flex gap-2">
        <InputGroup className="flex-1">
          <InputGroupPrefix>
            <Search className="size-5" />
          </InputGroupPrefix>
          <InputGroupInput
            type="text"
            aria-label={view === "packs" ? "Search for sample packs" : "Search for samples"}
            placeholder={view === "packs" ? "Search for sample packs..." : "Search for samples..."}
            value={query}
            onKeyDown={handleSearchKeyDown}
            onChange={handleSearchInput}
          />
          { /* Only show loading for searches whose results are displayed. */ }
          { searchLoading && showResults &&
            <InputGroupSuffix>
              <ProgressCircle aria-label="Loading results..." isIndeterminate className="size-5">
                <ProgressCircleTrack>
                  <ProgressCircleTrackCircle />
                  <ProgressCircleFillCircle />
                </ProgressCircleTrack>
              </ProgressCircle>
            </InputGroupSuffix>
          }
        </InputGroup>

        <Select
          aria-label="Sort by"
          value={sortBy}
          onChange={v => setSortBy(v as SpliceSortBy)}
          className="w-48"
        >
          <SelectTrigger>
            <ArrowUpDown className="size-4 me-2 self-center shrink-0 text-muted" />
            <SelectValue />
            <SelectIndicator />
          </SelectTrigger>
          <SelectPopover>
            <ListBox>
              <ListBoxItem id="relevance" textValue="Most relevant">Most relevant<ListBoxItemIndicator /></ListBoxItem>
              <ListBoxItem id="popularity" textValue="Most popular">Most popular<ListBoxItemIndicator /></ListBoxItem>
              <ListBoxItem id="recency" textValue="Most recent">Most recent<ListBoxItemIndicator /></ListBoxItem>
              <ListBoxItem id="random" textValue="Random">Random<ListBoxItemIndicator /></ListBoxItem>
            </ListBox>
          </SelectPopover>
        </Select>

        {(query || tags.length || instruments.size || genres.size || musicKey || chordType || bpm || sampleType !== "any") &&
          <Button variant="outline" onClick={() => {
            setQuery(""); setSearchQuery(""); setSearchRevision(value => value + 1);
            setTags([]); setInstruments(new Set()); setGenres(new Set());
            setMusicKey(null); setChordType(null); setBpm(undefined); setSampleType("any");
          }}>Clear search</Button>}
        <Button isIconOnly variant="outline" className={FIELD_BUTTON_CLASSES} aria-label="Settings" onClick={settings.open}>
          <Wrench className="size-4" />
        </Button>
      </div>

      {view === "packs" && <p className="text-sm text-muted">Browse packs by name. Audio filters find packs containing matching samples.</p>}
      <div className="flex gap-2">
        <Select aria-label="Instruments"
          selectionMode="multiple"
          placeholder="Instruments"
          value={Array.from(instruments)}
          onChange={x => setInstruments(new Set(x as string[]))}
          className="flex-1 min-w-0"
          fullWidth
        >
          <SelectTrigger className="max-w-full">
            <Guitar className="size-4 me-2 self-center shrink-0 text-muted" />
            <SelectValue className="truncate" />
            <SelectIndicator />
          </SelectTrigger>
          <SelectPopover>
            <ListBox items={knownInstruments}>
              {(x: {name: string, uuid: string}) => <ListBoxItem id={x.uuid} textValue={x.name}>{x.name}<ListBoxItemIndicator /></ListBoxItem>}
            </ListBox>
          </SelectPopover>
        </Select>

        <Select aria-label="Genres"
          selectionMode="multiple"
          placeholder="Genres"
          value={Array.from(genres)}
          onChange={x => setGenres(new Set(x as string[]))}
          className="flex-1 min-w-0"
          fullWidth
        >
          <SelectTrigger className="max-w-full">
            <Disc3 className="size-4 me-2 self-center shrink-0 text-muted" />
            <SelectValue className="truncate" />
            <SelectIndicator />
          </SelectTrigger>
          <SelectPopover>
            <ListBox items={knownGenres}>
              {(x: {name: string, uuid: string}) => <ListBoxItem id={x.uuid} textValue={x.name}>{x.name}<ListBoxItemIndicator /></ListBoxItem>}
            </ListBox>
          </SelectPopover>
        </Select>

        <Popover>
          <Button variant="outline" className={`${FIELD_BUTTON_CLASSES} flex-1 min-w-0 group ${NO_PRESS_SCALE}`}>
            <Music2 className="size-4 shrink-0 text-muted" />
            <span className="flex-1 truncate text-left">
              {
                (musicKey == null && chordType == null) ? "Key"
                  : `${musicKey ?? ""}${chordType == null ? "" : chordType == "major" ? " Major" : " Minor"}`
              }
            </span>
            <ChevronDown className="size-4 shrink-0 transition-transform duration-150 group-aria-expanded:rotate-180" />
          </Button>

          <PopoverContent placement="bottom">
            <PopoverDialog className="flex p-6">
              <KeyScaleSelection
                onChordSet={setChordType} onKeySet={setMusicKey}
                selectedChord={chordType} selectedKey={musicKey}
              />
            </PopoverDialog>
          </PopoverContent>
        </Popover>

        <Popover isOpen={bpmOpen} onOpenChange={setBpmOpen}>
          <Button variant="outline" className={`${FIELD_BUTTON_CLASSES} flex-1 min-w-0 group ${NO_PRESS_SCALE}`}>
            <Metronome className="size-4 shrink-0 text-muted" />
            <span className="flex-1 truncate text-left">
              { (bpmType == "exact" && bpm?.bpm
                  ? `${bpm?.bpm} BPM`
                  : bpmType == "range" && bpm?.maxBpm && bpm.minBpm
                    ? `${bpm.minBpm} – ${bpm.maxBpm} BPM`
                    : "BPM"
                )
              }
            </span>
            <ChevronDown className="size-4 shrink-0 transition-transform duration-150 group-aria-expanded:rotate-180" />
          </Button>

          <PopoverContent placement="bottom">
            <PopoverDialog className="p-6">
              <BpmSelection
                bpmType={bpmType}
                bpm={bpm}
                onSave={(type, newBpm) => {
                  setBpmType(type);
                  setBpm(newBpm);
                  setBpmOpen(false);
                }}
                onClear={() => {
                  setBpm(undefined);
                  setBpmOpen(false);
                }}
              />
            </PopoverDialog>
          </PopoverContent>
        </Popover>

        <Select aria-label="Type"
          value={sampleType}
          onChange={v => setSampleType(v as SpliceSampleType | "any")}
          className="flex-1 min-w-0"
        >
          <SelectTrigger>
            <Layers className="size-4 me-2 self-center shrink-0 text-muted" />
            { /* Render only the label here; the per-item icons belong in the dropdown. */ }
            <SelectValue>{({ selectedText }) => selectedText}</SelectValue>
            <SelectIndicator />
          </SelectTrigger>
          <SelectPopover>
            <ListBox>
              <ListBoxItem id="any" textValue="Any">
                <span className="size-4 shrink-0" aria-hidden="true" />
                Any<ListBoxItemIndicator />
              </ListBoxItem>
              <ListBoxItem id="oneshot" textValue="One-Shots">
                <MoveRight className="size-4 shrink-0 text-muted" />
                One-Shots<ListBoxItemIndicator />
              </ListBoxItem>
              <ListBoxItem id="loop" textValue="Loops">
                <Repeat className="size-4 shrink-0 text-muted" />
                Loops<ListBoxItemIndicator />
              </ListBoxItem>
            </ListBox>
          </SelectPopover>
        </Select>
      </div>

      { showResults && knownTags.length > 0 &&
        <div className="flex items-start gap-2">
          { /* Selected tags are pinned to the front; the rest follow, most popular first. */ }
          <div className={`flex-1 min-w-0 flex flex-wrap gap-1.5 ${tagsExpanded ? "" : "h-9 md:h-8 overflow-hidden"}`}>
            { [...tags, ...knownTags.filter(x => !tags.some(y => y.uuid == x.uuid))].map(x =>
              <ToggleButton key={x.uuid} size="sm" className={TAG_PILL_CLASSES}
                isSelected={tags.some(y => y.uuid == x.uuid)}
                onChange={() => toggleTag(x)}
              >{x.label}</ToggleButton>
            )}
          </div>

          <ToggleButton size="sm" isIconOnly className={TAG_PILL_CLASSES}
            aria-label={tagsExpanded ? "Show fewer tags" : "Show all tags"}
            isSelected={tagsExpanded}
            onChange={setTagsExpanded}
          >
            <EllipsisVertical className="size-4" />
          </ToggleButton>
        </div>
      }

      { /* Active pack filter banner; visually distinct from the tag pills so
           it's obvious results are narrowed down to a single pack. */ }
      { packFilter != null &&
        <div className="flex items-center gap-3 px-3 py-2 rounded-2xl bg-surface shadow-md">
          <img
            src={packFilter.files.find(x => x.asset_file_type_slug == "cover_image")?.url ?? "img/missing-cover.png"}
            alt="" width={36} height={36}
            className="rounded-sm object-cover shrink-0"
            draggable={false}
          />

          <div className="flex-1 min-w-0 flex flex-col">
            <span className="text-xs text-muted">
              Samples in this pack
            </span>
            <span className="truncate font-medium">{packFilter.name}</span>
          </div>

          {packSearch.current && <Button size="sm" variant="outline" onClick={showPacks}>Back to packs</Button>}
          <button
            type="button"
            aria-label={`Stop filtering by ${packFilter.name}`}
            onClick={() => {
              setPackFilter(null);
              setCurrentPage(1);
            }}
            className="flex items-center justify-center w-8 h-8 rounded-full shrink-0
                       cursor-pointer transition-colors hover:bg-surface-tertiary"
          >
            <X className="size-4" />
          </button>
        </div>
      }

      { sampleDirMissing && cfg().configured &&
        <Alert status="warning" className="items-center">
          <AlertIndicator />
          <AlertContent>
            <AlertTitle>Sample folder not found</AlertTitle>
            <AlertDescription>
              Drag-and-drop won't work until you choose an existing folder in the settings.
            </AlertDescription>
          </AlertContent>
          <Button size="sm" variant="secondary" onClick={settings.open}>Open settings</Button>
        </Alert>
      }

      {
        searchError != null
        ? <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <img className="w-12 select-none" src="img/blob-think.png" alt="" draggable={false} />
            <div className="space-y-1">
              <p className="text-muted">Something went wrong while searching.</p>
              <p className="text-sm text-muted/75 max-w-xl">{searchError}</p>
            </div>
          </div>
        : showResults
        ? resultCount == 0
        ? <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <img className="w-12 select-none" src="img/blob-think.png" alt="" draggable={false} />
            <p className="text-muted">{searchLoading ? "Searching…" : view === "packs" && filtersActive && currentPage < totalPages
              ? "No matching packs yet. Load more packs to continue searching."
              : "Couldn't find anything. Try changing your query and filters."}</p>
          </div>
        : <div ref={resultContainer} onScroll={rememberScroll} aria-label={view === "packs" ? "Sample packs" : "Sample results"} aria-busy={searchLoading}
            className="flex-1 min-h-0 mt-2 overflow-y-auto scrollbar-thin shadow-md bg-surface p-6 rounded-3xl flex flex-col gap-6"
        >
              <div className={`flex-1 ${view === "packs" ? "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5 content-start" : "flex flex-col"} transition-opacity duration-150
                              ${searchLoading ? "opacity-50 pointer-events-none" : ""}`}
              >
              { view === "packs" ? packs.map(pack => <PackCard key={pack.uuid} pack={pack} onOpen={handlePackClick} />) : results.map(
                x => <SampleListEntry key={x.uuid} sample={x} onTagClick={handleTagClick} onPackClick={handlePackClick} ctx={pbCtx}/>
              ) }
              </div>

              { totalPages > 1 && !(view === "packs" && filtersActive) &&
                <div className="w-full flex justify-center">
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => changePage(Math.max(1, currentPage - 1))}
                          isDisabled={currentPage <= 1}
                        >
                          <PaginationPreviousIcon />
                        </PaginationPrevious>
                      </PaginationItem>
                      {buildPageList(currentPage, totalPages).map((p, i) =>
                        p === "ellipsis"
                          ? <PaginationItem key={`ellipsis-${i}`}><PaginationEllipsis /></PaginationItem>
                          : <PaginationItem key={p}>
                              <PaginationLink isActive={p === currentPage} onClick={() => changePage(p)}>{p}</PaginationLink>
                            </PaginationItem>
                      )}
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => changePage(Math.min(totalPages, currentPage + 1))}
                          isDisabled={currentPage >= totalPages}
                        >
                          <PaginationNextIcon />
                        </PaginationNext>
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              }
            </div>
          : <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
              <img className="w-12 select-none" src="img/blob-salute.png" alt="" draggable={false} />
              <p className="text-muted">Waiting for your command!</p>
            </div>
      }
      {view === "packs" && filtersActive && searchError === null && currentPage < totalPages &&
        <div className="flex justify-center items-center gap-3 py-2">
          <p className="text-sm text-muted">{packs.length} packs found so far</p>
          <Button variant="outline" isDisabled={searchLoading} onClick={() => setCurrentPage(page => page + 1)}>Load more packs</Button>
        </div>}
    </main>
  );
}

export default App;
