import { referencedImageIds } from "../../images/image-reference";
import type { ImageId } from "../../images/image-id";
import { renderPrintHtml, showsPrintTitle } from "../../print/print-nodes";
import type { ActionNotices } from "../action-notices";
import type { CoreCommands } from "../api";
import type { AppSession } from "../app-session";
import { toBase64 } from "../base64";
import type { EngineEvents } from "../engine-events";
import type { HostServices } from "../host-services";
import { printDocumentHtml } from "../print-document";
import { notReady, stringParam, type CommandHandler } from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

export function createPrintCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly notices: ActionNotices;
}): Record<string, CommandHandler> {
  const { app } = context;

  return {
    async "print.render"(params): Promise<Result<"print.render">> {
      const name = stringParam(params, "name");
      const text = stringParam(params, "text");
      const current = app.current();
      if (current === null) throw notReady();
      const { imageResolver } = current.services;
      const images = new Map<ImageId, string>();
      await Promise.all(
        [...referencedImageIds(text)].map(async (id) => {
          const payload = await imageResolver.readPayload(id).catch(() => null);
          if (payload !== null) {
            images.set(
              id,
              `data:${payload.type};base64,${toBase64(payload.bytes)}`,
            );
          }
        }),
      );
      return {
        html: printDocumentHtml(
          name,
          renderPrintHtml(text, images),
          showsPrintTitle(name, text),
        ),
      };
    },
  };
}
