import { Disposable, workspace } from 'coc.nvim';
import { ExplorerSource } from '.';

class SourceManager {
  registeredSources: Record<string, ExplorerSource<any>> = {};

  constructor() {}

  registerSource(source: ExplorerSource<any>) {
    this.registeredSources[source.name] = source;
    return Disposable.create(() => {
      delete this.registeredSources[source.name];
    });
  }
}

export const sourceManager = new SourceManager();