import { createGitHubShareReader } from "./github/github-share-reader";
import { createGitLabShareReader } from "./gitlab/gitlab-share-reader";
import type { ShareReaders } from "./share-host";

export function createShareReaders(
  options: { fetch?: typeof fetch } = {},
): ShareReaders {
  return {
    github: createGitHubShareReader(options),
    gitlab: createGitLabShareReader(options),
  };
}
