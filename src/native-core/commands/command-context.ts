import { isForgeId, type ForgeId } from "../../forge/repo-coordinates";
import type { CoreError, CoreEvents } from "../api";
import { coreLevelError } from "../core-errors";

export type CommandParams = Readonly<Record<string, unknown>>;

export type CommandHandler = (params: CommandParams) => Promise<unknown>;

export type EmitCoreEvent = <Name extends keyof CoreEvents>(
  event: Name,
  payload: CoreEvents[Name],
) => void;

export class CoreCommandError extends Error {
  constructor(readonly coreError: CoreError) {
    super(coreError.kind);
    this.name = "CoreCommandError";
  }
}

export function invalidParams(): CoreCommandError {
  return new CoreCommandError(coreLevelError("invalidParams"));
}

export function notReady(): CoreCommandError {
  return new CoreCommandError(coreLevelError("notReady"));
}

export function stringParam(params: CommandParams, name: string): string {
  const value = params[name];
  if (typeof value !== "string") throw invalidParams();
  return value;
}

export function booleanParam(params: CommandParams, name: string): boolean {
  const value = params[name];
  if (typeof value !== "boolean") throw invalidParams();
  return value;
}

export function forgeParam(params: CommandParams, name: string): ForgeId {
  const value = params[name];
  if (!isForgeId(value)) throw invalidParams();
  return value;
}
