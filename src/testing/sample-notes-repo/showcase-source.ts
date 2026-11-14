import type { SampleEntry, SampleTag } from "./sample-source";

export const SHOWCASE_REPO_KEY = "sample/showcase";

export const showcaseHeroNote = {
  folder: ["Projects"],
  name: "Weather station",
} as const;

const WEATHER_STATION_MARKDOWN = [
  "# Weather station",
  "",
  "A small **Rust** service on the home server reads the balcony sensor every minute and appends each reading to `readings.csv`. The *dew point* follows the [Magnus formula](https://en.wikipedia.org/wiki/Dew_point).",
  "",
  "- [x] Wire the sensor to the board",
  "- [x] Log temperature and humidity",
  "- [ ] Send a frost alert below 2 °C",
  "",
  "| Reading | Range | Every |",
  "| --- | --- | --- |",
  "| Temperature | −40 to 85 °C | 60 s |",
  "| Humidity | 0 to 100 % | 60 s |",
  "",
  "> Readings drift by about half a degree when the enclosure sits in direct sun.",
  "",
  "```rust",
  "/// Magnus formula, t in °C, rh in %",
  "fn dew_point(t: f64, rh: f64) -> f64 {",
  "    let (a, b) = (17.62, 243.12);",
  "    let g = (rh / 100.0).ln()",
  "        + a * t / (b + t);",
  "    b * g / (a - g)",
  "}",
  "```",
  "",
].join("\n");

const BOOKSHELF_MARKDOWN = [
  "# Bookshelf",
  "",
  "Oak boards, 180 × 80 cm, five shelves. *Finish:* hard wax oil, two coats.",
  "",
  "- [x] Buy the boards",
  "- [x] Cut and sand",
  "- [ ] Assemble the frame",
  "- [ ] Oil and mount to the wall",
  "",
].join("\n");

const Q4_PLANNING_MARKDOWN = [
  "# Q4 planning",
  "",
  "**Goal:** ship the offline mode before the end of the year.",
  "",
  "## Decisions",
  "",
  "- Keep the release cadence at two weeks.",
  "- Move the design review to Tuesdays.",
  "",
  "## Action items",
  "",
  "- [x] Share the meeting notes",
  "- [ ] Draft the migration guide",
  "- [ ] Collect feedback from the beta group",
  "",
].join("\n");

const SEPTEMBER_RECAP_MARKDOWN = [
  "# September recap",
  "",
  "Long walks most evenings, and the tomatoes finally ripened. Started logging the balcony temperature, which turned into the weather station project.",
  "",
].join("\n");

const OCTOBER_GOALS_MARKDOWN = [
  "# October goals",
  "",
  "- Run three times a week",
  "- Finish the weather station",
  "- Read two books from the reading list",
  "- Get the radiators bled before the first cold night",
  "",
].join("\n");

const LENTIL_SOUP_MARKDOWN = [
  "# Lentil soup",
  "",
  "Serves four, ready in about 40 minutes.",
  "",
  "## Ingredients",
  "",
  "- 250 g red lentils, rinsed",
  "- 1 onion, 2 carrots, 2 cloves of garlic",
  "- 1 tsp cumin, 1 tsp smoked paprika",
  "- 1.2 l vegetable stock",
  "- Juice of half a lemon",
  "",
  "## Steps",
  "",
  "1. Soften the onion and carrots in olive oil for 8 minutes.",
  "2. Add the garlic and spices and stir for a minute.",
  "3. Pour in the lentils and stock, then simmer for 20 minutes.",
  "4. Blend until smooth and finish with the lemon juice.",
  "",
].join("\n");

const SOURDOUGH_LOAF_MARKDOWN = [
  "# Sourdough loaf",
  "",
  "1. Feed the starter the evening before.",
  "2. Mix 500 g flour, 350 g water and 100 g starter, then rest for an hour.",
  "3. Add 10 g salt and stretch and fold every 30 minutes, four times.",
  "4. Shape, proof overnight in the fridge and bake at 240 °C for 45 minutes.",
  "",
].join("\n");

const LISBON_ITINERARY_MARKDOWN = [
  "# Lisbon itinerary",
  "",
  "Four days in late October. Flights are booked; everything else is flexible.",
  "",
  "| Day | Plan |",
  "| --- | --- |",
  "| Thu | Arrive, walk around Alfama |",
  "| Fri | Tram 28, the castle, sunset at a viewpoint |",
  "| Sat | Day trip to Sintra by train |",
  "| Sun | Belém in the morning, fly home at 19:40 |",
  "",
  "- Buy a rechargeable transit card at the airport",
  "- Book the palace tickets a week ahead",
  "",
].join("\n");

const PACKING_LIST_MARKDOWN = [
  "# Packing list",
  "",
  "- [x] Passport",
  "- [x] Rain jacket",
  "- [ ] Comfortable walking shoes",
  "- [ ] Travel adapter",
  "- [ ] Charger and power bank",
  "",
].join("\n");

const READING_LIST_MARKDOWN = [
  "# Reading list",
  "",
  "1. *The Pragmatic Programmer*, chapters 2 and 7 again",
  "2. *Thinking, Fast and Slow*",
  "3. *The Design of Everyday Things*",
  "4. *A Pattern Language*",
  "",
].join("\n");

const INBOX_MARKDOWN = [
  "# Inbox",
  "",
  "- Renew the library card",
  "- Gift idea: a cast-iron pan",
  "- Look into a rain gauge for the weather station",
  "",
].join("\n");

export const showcaseRepoSource: readonly SampleEntry[] = [
  {
    kind: "folder",
    name: "Journal",
    children: [
      { kind: "note", name: "October goals", markdown: OCTOBER_GOALS_MARKDOWN },
      {
        kind: "note",
        name: "September recap",
        markdown: SEPTEMBER_RECAP_MARKDOWN,
      },
    ],
  },
  {
    kind: "folder",
    name: "Projects",
    children: [
      { kind: "note", name: "Bookshelf", markdown: BOOKSHELF_MARKDOWN },
      { kind: "note", name: "Q4 planning", markdown: Q4_PLANNING_MARKDOWN },
      {
        kind: "note",
        name: showcaseHeroNote.name,
        markdown: WEATHER_STATION_MARKDOWN,
      },
    ],
  },
  {
    kind: "folder",
    name: "Recipes",
    children: [
      { kind: "note", name: "Lentil soup", markdown: LENTIL_SOUP_MARKDOWN },
      {
        kind: "note",
        name: "Sourdough loaf",
        markdown: SOURDOUGH_LOAF_MARKDOWN,
      },
    ],
  },
  {
    kind: "folder",
    name: "Travel",
    children: [
      {
        kind: "note",
        name: "Lisbon itinerary",
        markdown: LISBON_ITINERARY_MARKDOWN,
      },
      { kind: "note", name: "Packing list", markdown: PACKING_LIST_MARKDOWN },
    ],
  },
  { kind: "note", name: "Inbox", markdown: INBOX_MARKDOWN },
  { kind: "note", name: "Reading list", markdown: READING_LIST_MARKDOWN },
];

export const showcaseRepoTags: readonly SampleTag[] = [
  { path: ["Projects", "Weather station"], color: "blue" },
  { path: ["Projects", "Q4 planning"], color: "red" },
  { path: ["Recipes", "Lentil soup"], color: "orange" },
  { path: ["Travel", "Lisbon itinerary"], color: "green" },
  { path: ["Reading list"], color: "purple" },
];
