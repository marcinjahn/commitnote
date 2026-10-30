import type { AppServicesContext } from "../app/start-app";
import {
  createNoteDates,
  type NoteDatesResolver,
} from "../history/note-dates";
import { createNoteHistory, type NoteHistory } from "../history/note-history";
import {
  createImageResolver,
  type ImageResolver,
} from "../images/image-resolver";
import { SHARE_IMAGE_PROFILE } from "../images/pipeline/image-profile";
import { createShareService, type ShareService } from "../share/share-service";
import { createRecentNotes, type RecentNotes } from "../ui/search/recent-notes";
import { processHostImage } from "./host-image-codec";
import type { HostServices } from "./host-services";
import { hostArgon2id } from "./runtime/host-argon2";

export interface NativeServices {
  readonly noteHistory: NoteHistory;
  readonly imageResolver: ImageResolver;
  readonly shareService: ShareService;
  readonly noteDates: NoteDatesResolver;
  readonly recentNotes: RecentNotes;
}

export function createNativeServices(
  context: AppServicesContext,
  host: HostServices,
  linkBase: string,
): NativeServices {
  const { session, sourceAdapter, adapter, engine, rateBudget, clock } =
    context;
  const noteHistory = createNoteHistory({ adapter, keyring: session.keyring });
  const imageResolver = createImageResolver({
    keyring: session.keyring,
    adapter,
    engine: {
      getPendingImage: (id) => engine.getPendingImage(id),
      getRestoredImageSha: (id) => engine.getRestoredImageSha(id),
      getImageIndex: () => engine.getState().synced?.images ?? null,
    },
  });
  return {
    noteHistory,
    imageResolver,
    shareService: createShareService({
      engine,
      shareHost: sourceAdapter.shareHost,
      noteHistory,
      images: {
        read: (id) => imageResolver.readPayload(id),
        reencode: (payload) =>
          processHostImage(
            host.imageCodec,
            new Blob([payload.bytes as Uint8Array<ArrayBuffer>], {
              type: payload.type,
            }),
            SHARE_IMAGE_PROFILE,
          ),
      },
      rateBudget,
      clock,
      argon2id: hostArgon2id(host.crypto),
      linkBase,
    }),
    noteDates: createNoteDates({ adapter, keyring: session.keyring, clock }),
    recentNotes: createRecentNotes(),
  };
}

export function disposeNativeServices(services: NativeServices): void {
  services.imageResolver.dispose();
}
