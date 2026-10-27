import { describe, expect, it, vi } from "vitest";
import { createIndexerEnvironment } from "./indexer-environment";

function fakePorts() {
  let online = true;
  let visible = true;
  const connectivityListeners = new Set<(online: boolean) => void>();
  const visibilityListeners = new Set<(visible: boolean) => void>();
  return {
    ports: {
      connectivity: {
        isOnline: () => online,
        subscribe(listener: (online: boolean) => void) {
          connectivityListeners.add(listener);
          return () => connectivityListeners.delete(listener);
        },
      },
      visibility: {
        isVisible: () => visible,
        subscribe(listener: (visible: boolean) => void) {
          visibilityListeners.add(listener);
          return () => visibilityListeners.delete(listener);
        },
      },
    },
    setOnline(value: boolean) {
      online = value;
      for (const l of [...connectivityListeners]) l(value);
    },
    setVisible(value: boolean) {
      visible = value;
      for (const l of [...visibilityListeners]) l(value);
    },
    listenerCount: () => connectivityListeners.size + visibilityListeners.size,
  };
}

describe("createIndexerEnvironment", () => {
  it("derives hidden and online from the ports", () => {
    const fake = fakePorts();
    const env = createIndexerEnvironment(fake.ports);
    expect(env.isHidden()).toBe(false);
    expect(env.isOnline()).toBe(true);
    fake.setVisible(false);
    fake.setOnline(false);
    expect(env.isHidden()).toBe(true);
    expect(env.isOnline()).toBe(false);
  });

  it("notifies on visibility and connectivity changes until unsubscribed", () => {
    const fake = fakePorts();
    const env = createIndexerEnvironment(fake.ports);
    const listener = vi.fn();
    const unsubscribe = env.subscribe(listener);

    fake.setVisible(false);
    fake.setOnline(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    fake.setOnline(true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(fake.listenerCount()).toBe(0);
  });
});
