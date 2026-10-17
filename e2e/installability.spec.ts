import { expect, test } from "./fixtures";
import {
  appManifest,
  installabilityErrors,
  launchPersistentPage,
} from "./helpers/installability";

test("the app is installable", async ({
  playwright,
  baseURL,
  channel,
  headless,
  launchOptions,
}) => {
  const { page, close } = await launchPersistentPage(playwright, {
    baseURL,
    channel,
    headless,
    launchOptions,
  });
  try {
    await page.goto("/");

    const manifest = await appManifest(page);
    expect(manifest.errors).toEqual([]);
    expect(manifest.url).toMatch(/manifest\.webmanifest$/);
    const data = JSON.parse(manifest.data ?? "{}") as {
      name?: string;
      icons?: { src: string }[];
    };
    expect(data.name).toBe("commitnote");

    await expect.poll(() => installabilityErrors(page)).toEqual([]);

    const appleTouchIcon = await page
      .locator('link[rel="apple-touch-icon"]')
      .evaluate((link) => (link as HTMLLinkElement).href);
    const iconUrls = [
      ...(data.icons ?? []).map((icon) => new URL(icon.src, manifest.url).href),
      appleTouchIcon,
    ];
    expect(iconUrls).toHaveLength(6);
    for (const url of iconUrls) {
      const response = await page.request.get(url);
      expect(response.status(), url).toBe(200);
      expect(response.headers()["content-type"], url).toMatch(/^image\/png/);
    }
  } finally {
    await close();
  }
});
