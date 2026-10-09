export type InstallPath = "prompt" | "ios";
export type InstallBarVariant = InstallPath | "none";

export interface InstallFacts {
  coarsePointer: boolean;
  browserDisplayMode: boolean;
  standalone: boolean;
  ios: boolean;
  deferredPrompt: boolean;
  dismissed: boolean;
  installed: boolean;
}

export interface InstallOffer {
  bar: InstallBarVariant;
  command: InstallPath | null;
}

export interface UserAgentEnvironment {
  userAgent: string;
  maxTouchPoints: number;
}

export function isIosDevice(env: UserAgentEnvironment): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  return env.userAgent.includes("Macintosh") && env.maxTouchPoints > 1;
}

export function installOffer(facts: InstallFacts): InstallOffer {
  const path: InstallPath | null = facts.deferredPrompt
    ? "prompt"
    : facts.ios
      ? "ios"
      : null;
  const installable = !facts.standalone && !facts.installed;
  const barVisible =
    facts.coarsePointer &&
    facts.browserDisplayMode &&
    installable &&
    !facts.dismissed;
  return {
    bar: path !== null && barVisible ? path : "none",
    command: path !== null && installable ? path : null,
  };
}
