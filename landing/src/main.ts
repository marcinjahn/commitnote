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
