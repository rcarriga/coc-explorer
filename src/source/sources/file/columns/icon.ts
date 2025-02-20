import { fileColumnRegistrar } from '../file-column-registrar';
import { sourceIcons, enableNerdfont } from '../../../source';
import pathLib from 'path';
// modified from:
//   icon code from https://github.com/ryanoasis/vim-devicons/blob/830f0fe48a337ed26384c43929032786f05c8d24/plugin/webdevicons.vim#L129
//   icon color from https://github.com/microsoft/vscode/blob/e75e71f41911633be838344377df26842f2b8c7c/extensions/theme-seti/icons/vs-seti-icon-theme.json
import nerdfontJson from './icons.nerdfont.json';
import { highlights as filenameHighlights } from './filename';
import { hlGroupManager, Hightlight } from '../../../highlight-manager';
import { config } from '../../../../util';
import { workspace } from 'coc.nvim';
import { FileNode } from '../file-source';
import { getSymbol } from '../../../../util/symbol';

const enableVimDevions = config.get<boolean>('icon.enableVimDevions')!;

const nerdfont = nerdfontJson as {
  icons: Record<
    string,
    {
      code: string;
      color: string;
    }
  >;
  extensions: Record<string, string>;
  filenames: Record<string, string>;
  patternMatches: Record<string, string>;
};

export const nerdfontHighlights: Record<string, Hightlight> = {};
Object.entries(nerdfont.icons).forEach(([name, icon]) => {
  nerdfontHighlights[name] = hlGroupManager.group(
    `FileIconNerdfont_${name}`,
    `guifg=${icon.color}`,
  );
});

function getBasename(filename: string): string {
  if (filename.replace(/^\./, '').includes('.')) {
    return getBasename(pathLib.basename(filename, pathLib.extname(filename)));
  } else {
    return filename;
  }
}

function getIcon(filename: string): undefined | { name: string; code: string; color: string } {
  const extname = pathLib.extname(filename).slice(1);
  const basename = getBasename(filename);

  if (nerdfont.filenames.hasOwnProperty(basename)) {
    const name = nerdfont.filenames[basename];
    return {
      name,
      ...nerdfont.icons[name],
    };
  }

  if (nerdfont.filenames.hasOwnProperty(filename)) {
    const name = nerdfont.filenames[filename];
    return {
      name,
      ...nerdfont.icons[name],
    };
  }

  const matched = Object.entries(nerdfont.patternMatches).find(([pattern]: [string, string]) =>
    new RegExp(pattern).test(filename),
  );
  if (matched) {
    const name = matched[1];
    return {
      name,
      ...nerdfont.icons[name],
    };
  }

  if (nerdfont.extensions.hasOwnProperty(extname)) {
    const name = nerdfont.extensions[extname];
    return {
      name,
      ...nerdfont.icons[name],
    };
  }
}

const attrSymbol = Symbol('icon-column');

function getAttr(node: FileNode) {
  return getSymbol(node, attrSymbol, () => ({
    devicons: '',
  }));
}

fileColumnRegistrar.registerColumn('icon', (source) => ({
  async beforeDraw(nodes) {
    if (enableVimDevions) {
      await Promise.all(
        nodes.map(async (node) => {
          getAttr(node).devicons = await workspace.nvim.call('WebDevIconsGetFileTypeSymbol', [
            node.name,
            false,
          ]);
        }),
      );
    }
  },
  async draw(row, node) {
    if (node.directory) {
      if (enableNerdfont) {
        row.add(
          source.expandStore.isExpanded(node)
            ? nerdfont.icons.folderOpened.code
            : nerdfont.icons.folderClosed.code,
          filenameHighlights.directory,
        );
      } else {
        row.add(
          source.expandStore.isExpanded(node) ? sourceIcons.expanded : sourceIcons.collapsed,
          filenameHighlights.directory,
        );
      }
      row.add(' ');
    } else {
      if (enableNerdfont) {
        const icon = getIcon(node.name.toLowerCase());
        if (icon && enableVimDevions) {
          icon.code = getAttr(node).devicons;
        }
        if (icon) {
          row.add(icon.code, nerdfontHighlights[icon.name]);
        } else if (node.hidden) {
          row.add(nerdfont.icons.fileHidden.code, nerdfontHighlights['fileHidden']);
        } else {
          row.add(nerdfont.icons.file.code, nerdfontHighlights['file']);
        }
      } else {
        row.add(' ');
      }
      row.add(' ');
    }
  },
}));
