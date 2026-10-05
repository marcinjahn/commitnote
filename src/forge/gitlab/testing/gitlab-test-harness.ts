import { http } from "msw";
import { MAIN_BRANCH, REPO_CONFIG_PATH } from "../../../format/v1";
import { commitFiles } from "../../fake/in-memory-git-repo";
import { useMswServer } from "../../fake/msw-test-server";
import { createGitLabAdapter } from "../gitlab-adapter";
import type { GitLabAdapterOptions } from "../gitlab-adapter";
import { MockGitLabRepo } from "./mock-gitlab-server";
import type { MockGitLabRepoOptions } from "./mock-gitlab-server";

const TOKEN = "s3cr3t-token";

/**
 * Registers the MSW server lifecycle and returns the helpers shared by the
 * GitLab adapter tests, all bound to one project path.
 */
export function useGitLabTestHarness(
  projectPath: string,
  mockDefaults: Partial<MockGitLabRepoOptions> = {},
) {
  const getServer = useMswServer();
  const separator = projectPath.lastIndexOf("/");
  const location = {
    owner: projectPath.slice(0, separator),
    repo: projectPath.slice(separator + 1),
  };

  function useMock(options?: Partial<MockGitLabRepoOptions>): MockGitLabRepo {
    const mock = new MockGitLabRepo({
      projectPath,
      token: TOKEN,
      ...mockDefaults,
      ...options,
    });
    getServer().use(...mock.handlers());
    return mock;
  }

  function makeAdapter(options?: Partial<GitLabAdapterOptions>) {
    return createGitLabAdapter(location, { accessToken: TOKEN, ...options });
  }

  function seed(
    mock: MockGitLabRepo,
    files: Record<string, string> = {},
  ): Promise<string> {
    return commitFiles(mock.git, {
      parent: null,
      files: { [REPO_CONFIG_PATH]: "{}", ...files },
      message: "init",
      branch: MAIN_BRANCH,
    });
  }

  function captureBodies<T = unknown>(
    method: "post" | "put",
    pattern: RegExp,
  ): T[] {
    const bodies: T[] = [];
    getServer().use(
      http[method](pattern, async ({ request }) => {
        bodies.push((await request.clone().json()) as T);
        return undefined;
      }),
    );
    return bodies;
  }

  function captureCommitBodies<T = unknown>(): T[] {
    return captureBodies<T>("post", /\/repository\/commits$/);
  }

  return {
    getServer,
    useMock,
    makeAdapter,
    seed,
    captureBodies,
    captureCommitBodies,
  };
}
