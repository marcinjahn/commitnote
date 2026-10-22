import { matchContents, matchNames } from "../../search/search-ranking";
import {
  contentRows,
  isPartial,
  nameRows,
  recentRows,
  resultCountText,
  searchProgress,
} from "../../search/search-results";
import { parseTerms } from "../../search/search-text";
import { parseColorTag, type ColorTag } from "../../tags/color-tag";
import { RESULT_CAP } from "../../search/search-tuning";
import {
  NAME_SECTION_HEADING,
  RECENT_SECTION_HEADING,
  SEARCH_HINT,
  STILL_READING,
  contentSectionHeading,
  describeNoMatches,
  describeSearchStatus,
  describeShowingFirst,
} from "../../ui/search/search-messages";
import type { CoreCommands, CoreEvents, SearchCopy } from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import type { EngineEvents } from "../engine-events";
import type { HostServices } from "../host-services";
import { toSearchRows } from "../search-view";
import {
  invalidParams,
  notReady,
  stringParam,
  type EmitCoreEvent,
  type CommandHandler,
  type CommandParams,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

function tagParam(params: CommandParams): ColorTag | null {
  const value = params.tag;
  if (value === null) return null;
  const tag = parseColorTag(value);
  if (tag === null) throw invalidParams();
  return tag;
}

function searchCopy(query: string, partial: boolean): SearchCopy {
  return {
    recentHeading: RECENT_SECTION_HEADING,
    namesHeading: NAME_SECTION_HEADING,
    contentsHeading: contentSectionHeading(partial),
    noMatches: query.trim() === "" ? "" : describeNoMatches(query),
    stillReading: STILL_READING,
    hint: SEARCH_HINT,
  };
}

function showingFirst(more: boolean): string | null {
  return more ? describeShowingFirst(RESULT_CAP) : null;
}

export function createSearchCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly emit: EmitCoreEvent;
}): Record<string, CommandHandler> {
  const { host, app, events, emit } = context;
  let open: {
    readonly owner: NativeRunningApp;
    readonly unsubscribe: () => void;
  } | null = null;

  function running(): NativeRunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  function release(): void {
    if (open === null) return;
    const { owner, unsubscribe } = open;
    open = null;
    unsubscribe();
    owner.contentIndexer.close();
  }

  app.onEngineState((engine) => {
    if (open !== null && open.owner.engine !== engine) release();
  });

  return {
    async "tags.setFilter"(params): Promise<Result<"tags.setFilter">> {
      const tag = tagParam(params);
      running();
      events.setTagFilter(tag);
      return {};
    },

    async "search.open"(): Promise<Result<"search.open">> {
      const current = running();
      release();
      const { contentIndexer } = current;
      let shown = "";
      const publish = (): void => {
        const state = contentIndexer.getState();
        const payload: CoreEvents["searchStatusChanged"] = {
          status: describeSearchStatus(
            state,
            app.activeForgeName(),
            host.clock.now(),
          ),
          progress: searchProgress(state),
          partial: isPartial(state),
        };
        const key = JSON.stringify(payload);
        if (key === shown) return;
        shown = key;
        emit("searchStatusChanged", payload);
      };
      open = { owner: current, unsubscribe: contentIndexer.subscribe(publish) };
      contentIndexer.open();
      publish();
      return {};
    },

    async "search.close"(): Promise<Result<"search.close">> {
      release();
      return {};
    },

    async "search.query"(params): Promise<Result<"search.query">> {
      const query = stringParam(params, "query");
      const current = running();
      const { contentIndexer } = current;
      const sources = contentIndexer.sources();
      const terms = parseTerms(query);
      const copy = searchCopy(query, isPartial(contentIndexer.getState()));
      if (terms.length === 0) {
        const openPath = current.engine.getState().openNote?.path ?? null;
        const recent = current.services.recentNotes.list(openPath);
        return {
          results: {
            recent: toSearchRows(recentRows(recent, openPath, sources)),
            names: [],
            contents: [],
            countText: null,
            namesMore: null,
            contentsMore: null,
            copy,
          },
        };
      }
      const nameSection = matchNames(sources, terms);
      const contentSection = matchContents(sources, terms, (source) =>
        contentIndexer.contentFor(source),
      );
      const names = nameRows(nameSection);
      const contents = contentRows(contentSection);
      return {
        results: {
          recent: [],
          names: toSearchRows(names),
          contents: toSearchRows(contents),
          countText:
            resultCountText(true, true, names.length + contents.length) ||
            null,
          namesMore: showingFirst(nameSection.more),
          contentsMore: showingFirst(contentSection.more),
          copy,
        },
      };
    },
  };
}
