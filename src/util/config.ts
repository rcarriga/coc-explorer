import { workspace } from 'coc.nvim';

export const config = workspace.getConfiguration('explorer');

export const enableDebug = config.get<boolean>('debug')!;

export const activeMode = config.get<boolean>('activeMode')!;

export const autoReveal = config.get<boolean>('file.autoReveal')!;

export const openStrategy = config.get<'vsplit' | 'previousBuffer' | 'select'>('openAction.strategy')!;
