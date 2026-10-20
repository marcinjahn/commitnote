import { describe, expect, it, vi } from "vitest";
import type { HostHttpRequest, HostHttpResponse, HostServices } from "../host-services";
import { Headers, Response, createHostFetch } from "./fetch";

function fakeHost(handler: (request: HostHttpRequest) => Promise<HostHttpResponse>) {
  const request = vi.fn(handler);
  return { host: { http: { request } } as unknown as HostServices, request };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("Headers", () => {
  it("is case-insensitive and joins repeated values", () => {
    const headers = new Headers({ "Content-Type": "text/plain" });
    headers.append("X-Many", "a");
    headers.append("x-many", "b");
    expect(headers.get("content-type")).toBe("text/plain");
    expect(headers.has("CONTENT-TYPE")).toBe(true);
    expect(headers.get("X-MANY")).toBe("a, b");
    expect(headers.get("missing")).toBeNull();
    headers.set("X-Many", "c");
    expect(headers.get("x-many")).toBe("c");
    headers.delete("Content-Type");
    expect(headers.has("content-type")).toBe(false);
  });

  it("iterates lower-cased names in sorted order", () => {
    const headers = new Headers([["B-Two", "2"], ["A-One", "1"]]);
    expect([...headers]).toEqual([["a-one", "1"], ["b-two", "2"]]);
    expect([...headers.keys()]).toEqual(["a-one", "b-two"]);
    expect([...headers.values()]).toEqual(["1", "2"]);
    expect([...new Headers(headers)]).toEqual([...headers]);
  });
});

describe("Response", () => {
  it("reports status, ok and an empty statusText", () => {
    expect(new Response("", { status: 204 }).ok).toBe(true);
    const failed = new Response("", { status: 404 });
    expect(failed.ok).toBe(false);
    expect(failed.statusText).toBe("");
  });

  it("reads json, text and arrayBuffer", async () => {
    expect(await new Response('{"a":[1,"é"]}').json()).toEqual({ a: [1, "é"] });
    expect(await new Response(bytes("héllo")).text()).toBe("héllo");
    const buffer = await new Response(bytes("abc")).arrayBuffer();
    expect([...new Uint8Array(buffer)]).toEqual([97, 98, 99]);
  });

  it("allows one read per body and tracks bodyUsed", async () => {
    const response = new Response("x");
    expect(response.bodyUsed).toBe(false);
    await response.text();
    expect(response.bodyUsed).toBe(true);
    await expect(response.text()).rejects.toThrow(TypeError);
    expect(() => response.clone()).toThrow(TypeError);
  });

  it("clones into independently readable bodies", async () => {
    const response = new Response('{"k":1}', { status: 201, headers: { "X-A": "1" } });
    const copy = response.clone();
    expect(await response.json()).toEqual({ k: 1 });
    expect(await copy.json()).toEqual({ k: 1 });
    expect(copy.status).toBe(201);
    expect(copy.headers.get("x-a")).toBe("1");
  });

  it("copies the body bytes it is given", async () => {
    const source = bytes("abc");
    const response = new Response(source);
    source[0] = 0;
    expect(await response.text()).toBe("abc");
  });
});

describe("createHostFetch", () => {
  it("builds the host request and wraps the host response", async () => {
    const { host, request } = fakeHost(async () => ({
      status: 200,
      headers: { "x-ratelimit-remaining": "42", link: '<https://x/?page=2>; rel="next"' },
      body: bytes('{"ok":true}'),
    }));
    const hostFetch = createHostFetch(() => host);
    const response = await hostFetch("https://api.github.com/x", {
      method: "post",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ a: "é" }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const sent = request.mock.calls[0]![0];
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("https://api.github.com/x");
    expect(sent.headers).toEqual({ authorization: "Bearer t", "content-type": "application/json" });
    expect(new TextDecoder().decode(sent.body!)).toBe('{"a":"é"}');
    expect(response.ok).toBe(true);
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("42");
    expect(response.headers.has("LINK")).toBe(true);
    expect(await response.clone().json()).toEqual({ ok: true });
    expect(await response.text()).toBe('{"ok":true}');
  });

  it("defaults to GET without a body and copies binary bodies", async () => {
    const { host, request } = fakeHost(async () => ({ status: 200, headers: {}, body: new Uint8Array(0) }));
    const hostFetch = createHostFetch(() => host);
    await hostFetch("https://x/");
    expect(request.mock.calls[0]![0]).toMatchObject({ method: "GET", body: null });

    const source = Uint8Array.from([1, 2, 3]);
    await hostFetch("https://x/", { method: "PUT", body: source });
    source[0] = 9;
    expect([...request.mock.calls[1]![0].body!]).toEqual([1, 2, 3]);

    const buffer = Uint8Array.from([4, 5]).buffer;
    await hostFetch("https://x/", { method: "PUT", body: buffer });
    expect([...request.mock.calls[2]![0].body!]).toEqual([4, 5]);
  });

  it("resolves non-2xx statuses", async () => {
    const { host } = fakeHost(async () => ({ status: 404, headers: {}, body: bytes("nope") }));
    const response = await createHostFetch(() => host)("https://x/");
    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
  });

  it("turns a rejected host request into a TypeError without its message", async () => {
    const { host } = fakeHost(async () => {
      throw new Error("secret-path/note.md unreachable");
    });
    const failure = createHostFetch(() => host)("https://x/");
    await expect(failure).rejects.toThrow(TypeError);
    await expect(failure).rejects.not.toThrow(/secret/);
  });

  it("rejects when no host is bound", async () => {
    const hostFetch = createHostFetch(() => {
      throw new Error("host not bound");
    });
    await expect(hostFetch("https://x/")).rejects.toThrow();
  });
});
