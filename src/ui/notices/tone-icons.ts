import type { ToastTone } from "./notice-messages";

export const toneIcons = {
  success: ["M3.5 8.5l3 3 6-7"],
  info: [
    "M14.25 8a6.25 6.25 0 1 1-12.5 0a6.25 6.25 0 1 1 12.5 0z",
    "M8 7.25v4",
    "M8 4.75v.01",
  ],
  warning: ["M8 1.75l6.5 11.5h-13z", "M8 6.25v3.25", "M8 11.5v.01"],
  error: [
    "M5.4 1.75h5.2l3.65 3.65v5.2l-3.65 3.65h-5.2l-3.65-3.65v-5.2z",
    "M8 4.75v3.75",
    "M8 11v.01",
  ],
} as const satisfies Record<ToastTone, readonly string[]>;

export const dismissIcon = ["M4 4l8 8", "M12 4l-8 8"] as const;
