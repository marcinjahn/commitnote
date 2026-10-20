import type { HostHttpRequest, HostServices } from "../host-services";
import { TextDecoder, TextEncoder } from "./text-codec";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type HeadersInit =
  | Headers
  | Record<string, string>
  | Iterable<readonly [string, string]>;

export class Headers {
  #map = new Map<string, string[]>();

  constructor(init?: HeadersInit | null) {
    if (init === undefined || init === null) return;
    if (init instanceof Headers) {
      for (const [name, value] of init) this.append(name, value);
    } else if (typeof (init as Iterable<unknown>)[Symbol.iterator] === "function") {
      for (const pair of init as Iterable<readonly [string, string]>) {
        const entry = [...pair];
        if (entry.length !== 2) {
          throw new TypeError("Each header must be a name and value pair");
        }
        this.append(entry[0], entry[1]);
      }
    } else {
      for (const name of Object.keys(init)) {
        this.append(name, (init as Record<string, string>)[name]!);
      }
    }
  }

  append(name: string, value: string): void {
    const key = String(name).toLowerCase();
    const values = this.#map.get(key);
    if (values === undefined) this.#map.set(key, [String(value)]);
    else values.push(String(value));
  }

  set(name: string, value: string): void {
    this.#map.set(String(name).toLowerCase(), [String(value)]);
  }

  get(name: string): string | null {
    const values = this.#map.get(String(name).toLowerCase());
    return values === undefined ? null : values.join(", ");
  }

  has(name: string): boolean {
    return this.#map.has(String(name).toLowerCase());
  }

  delete(name: string): void {
    this.#map.delete(String(name).toLowerCase());
  }

  forEach(callback: (value: string, name: string, parent: Headers) => void): void {
    for (const [name, value] of this) callback(value, name, this);
  }

  *entries(): IterableIterator<[string, string]> {
    for (const name of [...this.#map.keys()].sort()) {
      yield [name, this.get(name)!];
    }
  }

  *keys(): IterableIterator<string> {
    for (const [name] of this.entries()) yield name;
  }

  *values(): IterableIterator<string> {
    for (const [, value] of this.entries()) yield value;
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }
}

export type ResponseBody = Uint8Array | ArrayBuffer | string | null | undefined;

export interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
}

function bodyBytes(body: ResponseBody): Uint8Array {
  if (body === null || body === undefined) return new Uint8Array(0);
  if (typeof body === "string") return encoder.encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  return Uint8Array.from(body);
}

export class Response {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  #bytes: Uint8Array;
  #used = false;

  constructor(body?: ResponseBody, init: ResponseInit = {}) {
    const status = init.status ?? 200;
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      throw new RangeError("The status must be between 200 and 599");
    }
    this.status = status;
    this.statusText = init.statusText ?? "";
    this.headers = new Headers(init.headers);
    this.#bytes = bodyBytes(body);
  }

  get ok(): boolean {
    return this.status >= 200 && this.status <= 299;
  }

  get bodyUsed(): boolean {
    return this.#used;
  }

  #consume(): Uint8Array {
    if (this.#used) throw new TypeError("The body has already been read");
    this.#used = true;
    return this.#bytes;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.#consume().slice().buffer;
  }

  async text(): Promise<string> {
    return decoder.decode(this.#consume());
  }

  async json(): Promise<unknown> {
    return JSON.parse(decoder.decode(this.#consume()));
  }

  clone(): Response {
    if (this.#used) throw new TypeError("The body has already been read");
    return new Response(this.#bytes, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
    });
  }
}

interface FetchInit {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

function requestBody(body: unknown): Uint8Array | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return encoder.encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) {
    return Uint8Array.from(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    );
  }
  throw new TypeError("Unsupported request body");
}

export function createHostFetch(getHost: () => HostServices): typeof fetch {
  const hostFetch = async (
    input: string | { toString(): string },
    init: FetchInit = {},
  ): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [name, value] of new Headers(init.headers)) headers[name] = value;
    const request: HostHttpRequest = {
      method: String(init.method ?? "GET").toUpperCase(),
      url: String(input),
      headers,
      body: requestBody(init.body),
    };
    let result;
    try {
      result = await getHost().http.request(request);
    } catch {
      throw new TypeError("Network request failed");
    }
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    });
  };
  return hostFetch as unknown as typeof fetch;
}
