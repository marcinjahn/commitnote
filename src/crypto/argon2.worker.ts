import {
  argon2idDirect,
  type Argon2idInput,
  type Argon2WorkerResponse,
} from "./argon2";

// Typechecks against the DOM lib only (no "webworker" lib): `self` here is
// typed as Window, which happens to declare a compatible postMessage
// overload, since this file must build under the app's existing
// tsconfig.app.json.
self.onmessage = (event: MessageEvent<Argon2idInput>) => {
  argon2idDirect(event.data)
    .then((hash) => {
      const response: Argon2WorkerResponse = { ok: true, hash };
      self.postMessage(response, { transfer: [hash.buffer] });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const response: Argon2WorkerResponse = { ok: false, message };
      self.postMessage(response);
    });
};
