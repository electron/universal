declare namespace NodeJS {
  interface Process extends EventEmitter {
    // This is an undocumented private API. It exists.
    _archPath: string;
  }
}

declare module 'electron' {
  const app: Electron.App;

  namespace Electron {
    interface App {
      getAppPath: () => string;
      setAppPath: (p: string) => void;
    }
  }

  export { app };
}
