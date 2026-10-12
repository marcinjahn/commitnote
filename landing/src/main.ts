import {
  browserOptsOut,
  readAnalyticsOptOut,
  writeAnalyticsOptOut,
} from "../../src/analytics/analytics";

const root = document.documentElement;

function trackTyping(wordmark: HTMLElement): void {
  const letters = wordmark.querySelectorAll(".wordmark-letter");
  const last = letters[letters.length - 1];
  const done = () => {
    wordmark.dataset.typing = "done";
  };
  if (!last || !root.hasAttribute("data-motion") || last.getAnimations().length === 0) {
    done();
    return;
  }
  wordmark.dataset.typing = "typing";
  last.addEventListener("animationend", done, { once: true });
}

function playOnView(illustration: HTMLElement): void {
  if (!("IntersectionObserver" in window)) return;
  root.dataset.motionReady = "";
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      illustration.dataset.played = "";
    },
    { threshold: 0.4 },
  );
  observer.observe(illustration);
}

if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const wordmark = document.querySelector<HTMLElement>(".hero-wordmark");
  if (wordmark) trackTyping(wordmark);
  const illustration = document.querySelector<HTMLElement>(".commit-illustration");
  if (illustration) playOnView(illustration);
}

function initAnalyticsOptOut(): void {
  const button = document.querySelector<HTMLButtonElement>("#analytics-opt-out");
  const status = document.querySelector<HTMLElement>("#analytics-status");
  if (!button || !status) return;
  const render = () => {
    const optedOut = readAnalyticsOptOut();
    button.hidden = false;
    button.setAttribute("aria-pressed", String(optedOut));
    button.textContent = optedOut
      ? "Count my visits again"
      : "Don't count my visits in this browser";
    status.textContent = browserOptsOut(navigator)
      ? "Your browser's Do Not Track or Global Privacy Control setting already stops counting."
      : optedOut
        ? "Your visits in this browser are not counted."
        : "Your visits in this browser are counted anonymously.";
  };
  button.addEventListener("click", () => {
    writeAnalyticsOptOut(!readAnalyticsOptOut());
    render();
  });
  render();
}

initAnalyticsOptOut();
