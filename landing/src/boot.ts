import { applySavedColorMode } from "./color-mode";
import { appForwardingTarget, runsInstalled } from "./forwarding";

try {
  applySavedColorMode(localStorage, document);
} catch {}

let installed = false;
try {
  installed = runsInstalled((query) => matchMedia(query));
} catch {}

const target = appForwardingTarget(location, installed);
if (target !== null) location.replace(target);
