export interface PassphraseStrength {
  score: 0 | 1 | 2 | 3 | 4;
  warning: string;
}

export type StrengthChecker = (
  passphrase: string,
  userInputs: string[],
) => PassphraseStrength;

export interface StrengthDescription {
  label: string;
  filledSegments: number;
  weak: boolean;
}

export function describeStrength(score: number): StrengthDescription {
  if (score <= 1) return { label: "Weak", filledSegments: 1, weak: true };
  if (score === 2) return { label: "Fair", filledSegments: 2, weak: false };
  if (score === 3) return { label: "Good", filledSegments: 3, weak: false };
  return { label: "Strong", filledSegments: 4, weak: false };
}

let loading: Promise<StrengthChecker> | null = null;

export function loadStrengthChecker(): Promise<StrengthChecker> {
  loading ??= createChecker().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

async function createChecker(): Promise<StrengthChecker> {
  const [core, common, english] = await Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
    import("@zxcvbn-ts/language-en"),
  ]);
  const zxcvbn = new core.ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...english.dictionary },
    graphs: common.adjacencyGraphs,
    translations: english.translations,
  });
  return (passphrase, userInputs) => {
    const result = zxcvbn.check(passphrase, userInputs);
    return {
      score: result.score,
      warning: result.feedback.warning ?? "",
    };
  };
}

export function strengthUserInputs(repositoryLabel: string): string[] {
  return [
    ...repositoryLabel.split("/").filter((part) => part !== ""),
    "commitnote",
  ];
}
