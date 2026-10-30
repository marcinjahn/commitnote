import type { ImageId } from "../../images/image-id";
import { noteOwnsImage } from "../../images/image-ownership";
import {
  formatImageReference,
  parseImageReferences,
  referencedImageIds,
  rewriteImageReferences,
} from "../../images/image-reference";
import { NOTE_IMAGE_PROFILE } from "../../images/pipeline/image-profile";
import {
  MAX_IMAGES_PER_ACTION,
  prepareImages,
  type PrepareImagesOutcome,
} from "../../images/prepare-images";
import {
  describeAddingImages,
  describeImageOutcome,
} from "../../ui/images/image-messages";
import type { ActionNotices } from "../action-notices";
import type { CoreCommands } from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import type { EngineEvents } from "../engine-events";
import { processHostImage } from "../host-image-codec";
import type { HostServices } from "../host-services";
import {
  invalidParams,
  notReady,
  stringParam,
  type CommandHandler,
  type CommandParams,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

const BUSY_DELAY_MS = 300;

function inputsParam(params: CommandParams): string[] {
  const value = params.inputs;
  if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
    throw invalidParams();
  }
  return value as string[];
}

function nullablePathParam(params: CommandParams): string[] | null {
  const value = params.path;
  if (value === null) return null;
  if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
    throw invalidParams();
  }
  return value as string[];
}

export function createImageCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly notices: ActionNotices;
}): Record<string, CommandHandler> {
  const { host, app, events, notices } = context;

  function running(): NativeRunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  function takeInputs(inputs: readonly string[]): Blob[] {
    return inputs.map((input) => {
      const taken = host.imageCodec.takeInput(input) ?? {
        bytes: new Uint8Array(0),
        type: "",
      };
      return new Blob([taken.bytes as Uint8Array<ArrayBuffer>], {
        type: taken.type,
      });
    });
  }

  async function prepareWithBusyNotice(
    current: NativeRunningApp,
    inputs: readonly string[],
  ): Promise<PrepareImagesOutcome> {
    let busyId: string | null = null;
    const timer = host.clock.setTimeout(() => {
      busyId = notices.show(
        current,
        "image",
        "info",
        describeAddingImages(inputs.length),
      );
    }, BUSY_DELAY_MS);
    try {
      return await prepareImages(takeInputs(inputs), {
        keyring: current.session.keyring,
        process: async () => (input, profile) =>
          processHostImage(host.imageCodec, input, profile),
        profile: NOTE_IMAGE_PROFILE,
      });
    } catch {
      return {
        kind: "prepared",
        images: [],
        rejections: inputs.map(() => ({ kind: "unsupported" }) as const),
        total: inputs.length,
      };
    } finally {
      host.clock.clearTimeout(timer);
      if (busyId !== null) notices.clear("image", busyId);
    }
  }

  return {
    async "image.insert"(params): Promise<Result<"image.insert">> {
      const inputs = inputsParam(params);
      const current = running();
      if (current.engine.getState().stopped !== null) return { references: [] };
      const outcome: PrepareImagesOutcome =
        inputs.length > MAX_IMAGES_PER_ACTION
          ? { kind: "tooMany", count: inputs.length }
          : await prepareWithBusyNotice(current, inputs);
      const message = describeImageOutcome(outcome);
      if (message !== null && app.current() === current) {
        notices.show(current, "image", "error", message);
      }
      if (outcome.kind === "tooMany" || app.current() !== current) {
        return { references: [] };
      }
      return {
        references: outcome.images.map((image) => {
          current.engine.addPendingImage(image);
          return formatImageReference({
            imageId: image.imageId,
            alt: "",
            width: image.width,
            height: image.height,
          });
        }),
      };
    },

    async "image.clonePasted"(params): Promise<Result<"image.clonePasted">> {
      const path = nullablePathParam(params);
      const currentText = stringParam(params, "current");
      const pasted = stringParam(params, "pasted");
      const { engine } = running();
      if (!pasted.includes("image:")) return { text: pasted };
      const present = referencedImageIds(currentText);
      const images = engine.getState().synced?.images;
      const candidates = [
        ...new Set(
          parseImageReferences(pasted).map((reference) => reference.imageId),
        ),
      ].filter((id) => !present.has(id) && !noteOwnsImage(images, path, id));
      const clones = await Promise.all(
        candidates.map((id) => engine.cloneImage(id).catch(() => null)),
      );
      const replacements = new Map<ImageId, ImageId>();
      candidates.forEach((id, index) => {
        const clone = clones[index];
        if (clone != null) replacements.set(id, clone);
      });
      if (replacements.size === 0) return { text: pasted };
      return { text: rewriteImageReferences(pasted, replacements) };
    },
  };
}
