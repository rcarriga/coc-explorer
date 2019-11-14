import { Buffer, ExtensionContext, Window, workspace } from 'coc.nvim';
import { Action, ActionMode } from './mappings';
import { Args } from './parse-args';
import { IndexesManager } from './indexes-manager';
import './source/load';
import { BaseTreeNode, ExplorerSource } from './source/source';
import { sourceManager } from './source/source-manager';
import { execNotifyBlock, autoReveal, config, enableDebug } from './util';
import { ExplorerManager } from './explorer-manager';

export class Explorer {
  nvim = workspace.nvim;
  isHelpUI: boolean = false;
  indexesManager = new IndexesManager(this);
  inited = false;

  private _buffer?: Buffer;
  private _args?: Args;
  private _sources?: ExplorerSource<any>[];
  private _rootPath?: string;
  private lastArgSources?: string;

  constructor(
    public explorerID: number,
    public explorerManager: ExplorerManager,
    public context: ExtensionContext,
    public bufnr: number,
  ) {}

  get args(): Args {
    if (!this._args) {
      throw Error('Explorer args not initialized yet');
    }
    return this._args;
  }

  get sources(): ExplorerSource<any>[] {
    if (!this._sources) {
      throw Error('Explorer sources not initialized yet');
    }
    return this._sources;
  }

  get rootPath(): string {
    if (!this._rootPath) {
      throw Error('Explorer rootPath not initialized yet');
    }
    return this._rootPath;
  }

  get buffer(): Buffer {
    if (!this._buffer) {
      this._buffer = this.nvim.createBuffer(this.bufnr);
    }
    return this._buffer;
  }

  get win(): Promise<Window | null> {
    return this.winid.then((winid) => {
      if (winid) {
        return this.nvim.createWindow(winid);
      } else {
        return null;
      }
    });
  }

  /**
   * vim winnr of explorer
   */
  get winnr(): Promise<number | null> {
    return this.nvim.call('bufwinnr', this.bufnr).then((winnr: number) => {
      if (winnr > 0) {
        return winnr;
      } else {
        return null;
      }
    });
  }

  /**
   * vim winid of explorer
   */
  get winid(): Promise<number | null> {
    return this.winnr.then(async (winnr) => {
      if (winnr) {
        const winid = (await this.nvim.call('win_getid', winnr)) as number;
        if (winid >= 0) {
          return winid;
        } else {
          return null;
        }
      } else {
        return null;
      }
    });
  }

  async open(args: Args) {
    if (this.inited) {
      await this.resume(args);
    }

    this.inited = true;

    await this.initArgs(args);

    if (this.isHelpUI) {
      await this.sources[0].quitHelp();
    }

    await execNotifyBlock(async () => {
      for (const source of this.sources) {
        await source.opened(true);
      }

      const firstFileSource = this.sources.find((s) => s instanceof FileSource) as
        | FileSource
        | undefined;
      let node: FileNode | null = null;

      if (firstFileSource) {
        firstFileSource.root = this.rootPath;
      }

      await this.reloadAll({ render: false });

      if (firstFileSource) {
        if (this.args.revealPath && autoReveal) {
          node = await firstFileSource.revealNodeByPath(
            this.args.revealPath,
            firstFileSource.rootNode.children,
          );
        }
      }

      await this.renderAll({ notify: true });

      if (firstFileSource) {
        if (this.args.revealPath && autoReveal) {
          if (node !== null) {
            await firstFileSource.gotoNode(node, { col: 1, notify: true });
          } else {
            await firstFileSource.gotoRoot({ col: 1, notify: true });
          }
        }
      }
    });
  }

  async resume(args: Args) {
    const win = await this.win;
    if (win) {
      if (args.toggle) {
        await win.close(true);
      } else {
        await this.nvim.eval(`${win.number}wincmd w`);
      }
    } else {
      await this.nvim.call('coc_explorer#resume', [this.bufnr, args.position, args.width]);
    }
  }

  async quit() {
    const win = await this.win;
    if (win) {
      await win.close(true);
    }
  }

  private async getRootPath() {
    let useGetcwd = false;
    const buftype = await this.nvim.getVar('&buftype');
    if (buftype === 'nofile') {
      useGetcwd = true;
    } else {
      const bufname = await this.nvim.call('bufname', ['%']);
      if (!bufname) {
        useGetcwd = true;
      }
    }
    return useGetcwd ? ((await this.nvim.call('getcwd', [])) as string) : workspace.rootPath;
  }

  private async initArgs(args: Args) {
    this._args = args;
    if (!this.lastArgSources || this.lastArgSources !== args.sources.toString()) {
      this.lastArgSources = args.sources.toString();

      this._sources = this.args.sources
        .map((sourceArg) => sourceManager.createSource(sourceArg.name, this, sourceArg.expand))
        .filter((source): source is ExplorerSource<any> => source !== null);
    }

    this._rootPath = this.args.rootPath || (await this.getRootPath());
    this.explorerManager.rootPathRecords.add(this._rootPath);
  }

  async prompt(msg: string): Promise<'yes' | 'no' | null>;
  async prompt<T extends string>(msg: string, choices: T[], defaultChoice?: T): Promise<T | null>;
  async prompt(msg: string, choices?: string[], defaultChoice?: string): Promise<string | null> {
    if (!choices) {
      choices = ['yes', 'no'];
      defaultChoice = 'no';
    }
    const defaultNumber = defaultChoice ? choices.indexOf(defaultChoice) : -1;
    const result = (await this.nvim.call('confirm', [
      msg,
      choices
        .map((c) => {
          return '&' + c[0].toUpperCase() + c.slice(1);
        })
        .join('\n'),
      defaultNumber + 1,
    ])) as number;
    if (result === 0) {
      return null;
    } else {
      return choices[result - 1] || null;
    }
  }

  async doActions(actions: Action[], mode: ActionMode = 'n') {
    for (const action of actions) {
      await this.doAction(action, mode);
    }
    await execNotifyBlock(async () => {
      await Promise.all(
        this.sources.map(async (source) => {
          return source.emitRequestRenderNodes(true);
        }),
      );
    });
  }

  async doAction(action: Action, mode: ActionMode = 'n') {
    const { nvim } = this;
    const now = Date.now();

    const lineIndexes: number[] = [];
    const document = await workspace.document;
    if (mode === 'v') {
      const range = await workspace.getSelectedRange('v', document);
      if (range) {
        for (let line = range.start.line; line <= range.end.line; line++) {
          lineIndexes.push(line);
        }
      }
    } else {
      const line = ((await nvim.call('line', '.')) as number) - 1;
      lineIndexes.push(line);
    }

    const nodesGroup: Map<ExplorerSource<any>, Set<object | null>> = new Map();

    for (const lineIndex of lineIndexes) {
      const [source] = this.findSourceByLineIndex(lineIndex);
      if (source) {
        if (!nodesGroup.has(source)) {
          nodesGroup.set(source, new Set());
        }
        const relativeLineIndex = lineIndex - source.startLine;

        nodesGroup
          .get(source)!
          .add(relativeLineIndex === 0 ? null : source.flattenedNodes[relativeLineIndex]);
      }
    }

    await Promise.all(
      Array.from(nodesGroup.entries()).map(async ([source, nodes]) => {
        if (nodes.has(null)) {
          await source.doRootAction(action.name, action.arg);
        } else {
          await source.doAction(
            action.name,
            Array.from(nodes).filter((item) => item),
            action.arg,
            mode,
          );
        }
      }),
    );

    if (enableDebug) {
      let actionDisplay = action.name;
      if (action.arg) {
        actionDisplay += ':' + action.arg;
      }
      // tslint:disable-next-line: ban
      workspace.showMessage(`action(${actionDisplay}): ${Date.now() - now}ms`, 'more');
    }
  }

  private findSourceByLineIndex(lineIndex: number) {
    const sourceIndex = this.sources.findIndex((source) => lineIndex < source.endLine);
    if (sourceIndex === -1) {
      return [null, -1] as [null, -1];
    } else {
      return [this.sources[sourceIndex], sourceIndex] as [ExplorerSource<any>, number];
    }
  }

  async currentCursor() {
    const win = await this.win;
    if (win) {
      const [line, col] = await win.cursor;
      const lineIndex = line - 1;
      return {
        lineIndex,
        col: col + 1,
      };
    }
    return null;
  }

  async currentLineIndex() {
    const cursor = await this.currentCursor();
    if (cursor) {
      return cursor.lineIndex;
    }
    return 0;
  }

  async currentCol() {
    const cursor = await this.currentCursor();
    if (cursor) {
      return cursor.col;
    }
    return 0;
  }

  async storeCursor() {
    const storeCursor = await this.currentCursor();
    let storeView = await this.nvim.call('winsaveview');
    storeView = { topline: storeView.topline };
    if (storeCursor) {
      const [, sourceIndex] = this.findSourceByLineIndex(storeCursor.lineIndex);
      const source = this.sources[sourceIndex];
      if (source) {
        const sourceLineIndex = storeCursor.lineIndex - source.startLine;
        const storeNode: BaseTreeNode<any> = source.getNodeByLine(sourceLineIndex);
        return async (notify = false) => {
          await execNotifyBlock(async () => {
            this.nvim.call('winrestview', [storeView], true);
            await source.gotoNode(storeNode, {
              lineIndex: sourceLineIndex,
              col: storeCursor.col,
              notify: true,
            });
          }, notify);
        };
      }
    }
    return async (notify = false) => {
      await execNotifyBlock(() => {
        this.nvim.call('winrestview', storeView, true);
      }, notify);
    };
  }

  async gotoLineIndex(lineIndex: number, col?: number, notify = false) {
    await execNotifyBlock(async () => {
      const finalCol = col === undefined ? await this.currentCol() : col;
      const win = await this.win;
      if (win) {
        win.setCursor([lineIndex + 1, finalCol - 1], true);
        if (!(await this.explorerManager.currentExplorer())) {
          this.nvim.command('redraw!', true);
        }
      }
    }, notify);
  }

  async setLines(lines: string[], start: number, end: number, notify = false) {
    await execNotifyBlock(async () => {
      this.buffer.setOption('modifiable', true, true);

      await this.buffer.setLines(
        lines,
        {
          start,
          end,
        },
        true,
      );

      this.buffer.setOption('modifiable', false, true);
    }, notify);
  }

  // private async clearContent() {
  //   await this.setLines([], 0, -1, true);
  //
  //   this.sources.forEach((source) => {
  //     source.lines = [];
  //     source.startLine = 0;
  //     source.endLine = 0;
  //   });
  // }

  async reloadAll({ render = true, notify = false } = {}) {
    await execNotifyBlock(async () => {
      await Promise.all(
        this.sources.map((source) =>
          source.reload(source.rootNode, { render: false, notify: true }),
        ),
      );

      if (render) {
        await this.renderAll({ notify: true, storeCursor: false });
      }
    }, notify);
  }

  async renderAll({ notify = false, storeCursor = false } = {}) {
    await execNotifyBlock(async () => {
      const store = storeCursor ? await this.storeCursor() : null;

      // await this.clearContent();
      for (const source of this.sources) {
        await source.render({ notify: true, storeCursor: false });
      }

      if (store) {
        await store(true);
      }
    }, notify);
  }

  /**
   * select windows from current tabpage
   */
  async selectWindowsUI(
    selected: (winnr: number) => void | Promise<void>,
    noChoice: () => void | Promise<void> = () => {},
  ) {
    const winnr = await this.nvim.call('coc_explorer#select_wins', [
      this.explorerManager.bufferName,
      config.get<boolean>('openAction.select.filterFloatWindows')!,
    ]);
    if (winnr > 0) {
      await Promise.resolve(selected(winnr));
    } else if (winnr === 0) {
      await Promise.resolve(noChoice());
    }
  }
}

import { FileNode, FileSource } from './source/sources/file/file-source';
