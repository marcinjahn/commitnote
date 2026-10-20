import { TextDecoder, TextEncoder } from "./text-codec";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

function percentEncode(input: string, shouldEncode: (code: number) => boolean) {
  let out = "";
  for (const char of input) {
    const code = char.codePointAt(0)!;
    if (code < 0x80 && !shouldEncode(code)) {
      out += char;
      continue;
    }
    for (const byte of encoder.encode(char)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

const isControlOrSpace = (code: number) => code <= 0x20 || code === 0x7f;
const encodePath = (code: number) =>
  isControlOrSpace(code) || '"#<>?`{}'.includes(String.fromCharCode(code));
const encodeQuery = (code: number) =>
  isControlOrSpace(code) || "\"#<>'".includes(String.fromCharCode(code));
const encodeFragment = (code: number) =>
  isControlOrSpace(code) || '"<>`'.includes(String.fromCharCode(code));

function formEncode(input: string): string {
  let out = "";
  for (const byte of encoder.encode(input)) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9*\-._]/.test(char)) out += char;
    else if (byte === 0x20) out += "+";
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function percentDecode(input: string): string {
  const bytes: number[] = [];
  const raw = encoder.encode(input);
  for (let i = 0; i < raw.length; i++) {
    const byte = raw[i]!;
    const hex =
      byte === 0x25 && i + 2 < raw.length
        ? String.fromCharCode(raw[i + 1]!, raw[i + 2]!)
        : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(byte);
    }
  }
  return decoder.decode(Uint8Array.from(bytes));
}

function formDecode(input: string): string {
  return percentDecode(input.replace(/\+/g, " "));
}

export type URLSearchParamsInit =
  | string
  | Record<string, string>
  | Iterable<readonly [string, string]>
  | URLSearchParams;

export class URLSearchParams {
  #list: [string, string][] = [];
  #onChange: (() => void) | null = null;

  constructor(init: URLSearchParamsInit = "") {
    if (typeof init === "string") {
      this.#parse(init);
    } else if (init instanceof URLSearchParams) {
      this.#list = init.#list.map(([name, value]) => [name, value]);
    } else if (
      init !== null &&
      typeof (init as Iterable<unknown>)[Symbol.iterator] === "function"
    ) {
      for (const pair of init as Iterable<readonly [string, string]>) {
        const entry = [...pair];
        if (entry.length !== 2) {
          throw new TypeError("Each pair must contain exactly two items");
        }
        this.#list.push([String(entry[0]), String(entry[1])]);
      }
    } else if (init !== null && typeof init === "object") {
      for (const name of Object.keys(init)) {
        this.#list.push([name, String((init as Record<string, string>)[name])]);
      }
    } else {
      this.#parse(String(init));
    }
  }

  static bind(params: URLSearchParams, onChange: () => void): void {
    params.#onChange = onChange;
  }

  static reset(params: URLSearchParams, query: string): void {
    params.#parse(query);
  }

  #parse(input: string): void {
    this.#list = [];
    const query = input.startsWith("?") ? input.slice(1) : input;
    for (const part of query.split("&")) {
      if (part === "") continue;
      const index = part.indexOf("=");
      const name = index === -1 ? part : part.slice(0, index);
      const value = index === -1 ? "" : part.slice(index + 1);
      this.#list.push([formDecode(name), formDecode(value)]);
    }
  }

  #changed(): void {
    this.#onChange?.();
  }

  get size(): number {
    return this.#list.length;
  }

  append(name: string, value: string): void {
    this.#list.push([String(name), String(value)]);
    this.#changed();
  }

  delete(name: string): void {
    const key = String(name);
    this.#list = this.#list.filter(([existing]) => existing !== key);
    this.#changed();
  }

  get(name: string): string | null {
    const key = String(name);
    return this.#list.find(([existing]) => existing === key)?.[1] ?? null;
  }

  getAll(name: string): string[] {
    const key = String(name);
    return this.#list
      .filter(([existing]) => existing === key)
      .map(([, value]) => value);
  }

  has(name: string): boolean {
    const key = String(name);
    return this.#list.some(([existing]) => existing === key);
  }

  set(name: string, value: string): void {
    const key = String(name);
    const text = String(value);
    const index = this.#list.findIndex(([existing]) => existing === key);
    if (index === -1) {
      this.#list.push([key, text]);
    } else {
      this.#list[index] = [key, text];
      this.#list = this.#list.filter(
        ([existing], i) => i <= index || existing !== key,
      );
    }
    this.#changed();
  }

  sort(): void {
    this.#list = this.#list
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) =>
        a.entry[0] < b.entry[0] ? -1 : a.entry[0] > b.entry[0] ? 1 : a.index - b.index,
      )
      .map(({ entry }) => entry);
    this.#changed();
  }

  forEach(
    callback: (value: string, name: string, parent: URLSearchParams) => void,
  ): void {
    for (const [name, value] of this.#list) callback(value, name, this);
  }

  *entries(): IterableIterator<[string, string]> {
    for (const [name, value] of this.#list) yield [name, value];
  }

  *keys(): IterableIterator<string> {
    for (const [name] of this.#list) yield name;
  }

  *values(): IterableIterator<string> {
    for (const [, value] of this.#list) yield value;
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }

  toString(): string {
    return this.#list
      .map(([name, value]) => `${formEncode(name)}=${formEncode(value)}`)
      .join("&");
  }
}

interface Parts {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  path: string;
  query: string;
  fragment: string;
}

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

function invalid(): TypeError {
  return new TypeError("Invalid URL");
}

function normalizePath(path: string): string {
  const out: string[] = [];
  const segments = path.split("/");
  segments.forEach((segment, index) => {
    const lower = segment.toLowerCase();
    const last = index === segments.length - 1;
    if (lower === ".." || lower === ".%2e" || lower === "%2e." || lower === "%2e%2e") {
      if (out.length > 1) out.pop();
      if (last) out.push("");
    } else if (lower === "." || lower === "%2e") {
      if (last) out.push("");
    } else {
      out.push(segment);
    }
  });
  const joined = out.join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function parseAuthority(
  authority: string,
  protocol: string,
): Pick<Parts, "username" | "password" | "hostname" | "port"> {
  const at = authority.lastIndexOf("@");
  let username = "";
  let password = "";
  if (at !== -1) {
    const userinfo = authority.slice(0, at);
    const colon = userinfo.indexOf(":");
    const encodeUser = (code: number) =>
      encodePath(code) || "/:;=@[\\]^|".includes(String.fromCharCode(code));
    username = percentEncode(
      colon === -1 ? userinfo : userinfo.slice(0, colon),
      encodeUser,
    );
    password = percentEncode(
      colon === -1 ? "" : userinfo.slice(colon + 1),
      encodeUser,
    );
  }
  const hostPort = authority.slice(at + 1);
  const portMatch = /^(.*?)(?::(\d*))?$/.exec(hostPort)!;
  const hostText = hostPort.startsWith("[")
    ? hostPort.slice(0, hostPort.indexOf("]") + 1)
    : portMatch[1]!;
  const portText = hostPort.startsWith("[")
    ? hostPort.slice(hostText.length).replace(/^:/, "")
    : (portMatch[2] ?? "");
  if (hostPort.startsWith("[") && !/^(:\d*)?$/.test(hostPort.slice(hostText.length))) {
    throw invalid();
  }
  const hostname = percentDecode(hostText).toLowerCase();
  if (
    hostname === "" ||
    /[\u0000- #%/:<>?@[\\\]^|\u007f\u0080-￿]/.test(
      hostname.startsWith("[") ? "" : hostname,
    )
  ) {
    throw invalid();
  }
  let port = portText === "" ? "" : String(Number(portText));
  if (port !== "" && Number(port) > 65535) throw invalid();
  if (port === DEFAULT_PORTS[protocol]) port = "";
  return { username, password, hostname, port };
}

function parseAbsolute(input: string, protocol: string): Parts {
  let rest = input.slice(protocol.length).replace(/\\/g, "/");
  if (!rest.startsWith("//")) throw invalid();
  rest = rest.slice(2);
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  rest = end === -1 ? "" : rest.slice(end);
  return { protocol, ...parseAuthority(authority, protocol), ...splitRest(rest, "/") };
}

function splitRest(
  rest: string,
  defaultPath: string,
): Pick<Parts, "path" | "query" | "fragment"> {
  let fragment = "";
  let query = "";
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    fragment = percentEncode(rest.slice(hash + 1), encodeFragment);
    rest = rest.slice(0, hash);
  }
  const question = rest.indexOf("?");
  if (question !== -1) {
    query = percentEncode(rest.slice(question + 1), encodeQuery);
    rest = rest.slice(0, question);
  }
  const path = normalizePath(percentEncode(rest === "" ? defaultPath : rest, encodePath));
  return { path, query, fragment };
}

function parse(rawInput: string, base?: Parts): Parts {
  const input = rawInput.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "").replace(/[\t\n\r]/g, "");
  const scheme = SCHEME.exec(input);
  if (scheme !== null) {
    const protocol = `${scheme[1]!.toLowerCase()}:`;
    if (protocol !== "http:" && protocol !== "https:") throw invalid();
    if (base === undefined || base.protocol !== protocol || input.slice(protocol.length).replace(/\\/g, "/").startsWith("//")) {
      return parseAbsolute(input, protocol);
    }
  }
  if (base === undefined) throw invalid();
  const relative = (scheme === null ? input : input.slice(scheme[0].length)).replace(/\\/g, "/");
  if (relative.startsWith("//")) {
    return parseAbsolute(`${base.protocol}${relative}`, base.protocol);
  }
  const { protocol, username, password, hostname, port } = base;
  const origin = { protocol, username, password, hostname, port };
  if (relative.startsWith("/")) {
    return { ...origin, ...splitRest(relative, "/") };
  }
  if (relative === "" || relative.startsWith("?") || relative.startsWith("#")) {
    const parts = splitRest(relative, base.path);
    const keepsQuery = relative === "" || relative.startsWith("#");
    return {
      ...origin,
      path: base.path,
      query: keepsQuery ? base.query : parts.query,
      fragment: parts.fragment,
    };
  }
  const directory = base.path.slice(0, base.path.lastIndexOf("/") + 1);
  return { ...origin, ...splitRest(`${directory}${relative}`, "/") };
}

export class URL {
  #parts: Parts;
  #params: URLSearchParams;

  constructor(url: string | { toString(): string }, base?: string | URL) {
    const baseParts =
      base === undefined ? undefined : new URL(String(base)).#parts;
    this.#parts = parse(String(url), baseParts);
    this.#params = new URLSearchParams(this.#parts.query);
    this.#bindParams();
  }

  #bindParams(): void {
    URLSearchParams.bind(this.#params, () => {
      const serialized = this.#params.toString();
      this.#parts.query = serialized;
    });
  }

  get protocol(): string {
    return this.#parts.protocol;
  }

  get username(): string {
    return this.#parts.username;
  }

  get password(): string {
    return this.#parts.password;
  }

  get hostname(): string {
    return this.#parts.hostname;
  }

  get port(): string {
    return this.#parts.port;
  }

  get host(): string {
    return this.#parts.port === ""
      ? this.#parts.hostname
      : `${this.#parts.hostname}:${this.#parts.port}`;
  }

  get origin(): string {
    return `${this.#parts.protocol}//${this.host}`;
  }

  get pathname(): string {
    return this.#parts.path;
  }

  get search(): string {
    return this.#parts.query === "" ? "" : `?${this.#parts.query}`;
  }

  set search(value: string) {
    const text = String(value);
    const query = text.startsWith("?") ? text.slice(1) : text;
    this.#parts.query = percentEncode(query, encodeQuery);
    URLSearchParams.reset(this.#params, this.#parts.query);
  }

  get hash(): string {
    return this.#parts.fragment === "" ? "" : `#${this.#parts.fragment}`;
  }

  set hash(value: string) {
    const text = String(value);
    this.#parts.fragment = percentEncode(
      text.startsWith("#") ? text.slice(1) : text,
      encodeFragment,
    );
  }

  get searchParams(): URLSearchParams {
    return this.#params;
  }

  get href(): string {
    const { protocol, username, password, path } = this.#parts;
    const credentials =
      username === "" && password === ""
        ? ""
        : `${username}${password === "" ? "" : `:${password}`}@`;
    return `${protocol}//${credentials}${this.host}${path}${this.search}${this.hash}`;
  }

  toString(): string {
    return this.href;
  }

  toJSON(): string {
    return this.href;
  }
}
