import { CircuithubRequest, CircuithubResponse } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../../electron/ElectronSafeStorage.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as DesktopIpc from "../../ipc/DesktopIpc.ts";
import * as IpcChannels from "../../ipc/channels.ts";
import { createCircuithubService } from "./service.ts";

class CircuithubIpcError extends Schema.TaggedError<CircuithubIpcError>()("CircuithubIpcError", {
  cause: Schema.Defect(),
}) {}

export const installCircuithub = Effect.fn("desktop.circuithub.install")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const storage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const shell = yield* ElectronShell.ElectronShell;
  const fs = yield* FileSystem.FileSystem;
  const context = yield* Effect.context<never>();
  const run = Effect.runPromiseWith(context);
  const tokenFile = environment.path.join(environment.appDataDirectory, "circuithub-session");
  const canPersist = Effect.gen(function* () {
    return (
      (yield* storage.isEncryptionAvailable) &&
      Option.getOrNull(yield* storage.selectedStorageBackend) !== "basic_text"
    );
  });
  const service = createCircuithubService({
    readSession: () =>
      run(
        Effect.gen(function* () {
          if (!(yield* fs.exists(tokenFile)) || !(yield* canPersist)) return null;
          return yield* storage.decryptString(yield* fs.readFile(tokenFile));
        }),
      ),
    writeSession: (token) =>
      run(
        Effect.gen(function* () {
          if (!(yield* canPersist)) return false;
          const encrypted = yield* storage.encryptString(token);
          yield* fs.makeDirectory(environment.appDataDirectory, { recursive: true });
          const temporary = `${tokenFile}.tmp`;
          yield* fs.writeFile(temporary, encrypted, { mode: 0o600 });
          yield* fs.rename(temporary, tokenFile);
          return true;
        }),
      ),
    clearSession: () => run(fs.remove(tokenFile, { force: true })),
    openBrowser: (url) => run(shell.openExternal(url)),
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => service.close()));
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: IpcChannels.CIRCUITHUB_CHANNEL,
      payload: CircuithubRequest,
      result: CircuithubResponse,
      handler: (request) =>
        Effect.tryPromise({
          try: () => service.request(request),
          catch: (cause) => new CircuithubIpcError({ cause }),
        }),
    }),
  );
});
