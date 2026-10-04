import { t } from '../lib/i18n.js';
import { type IconName, icon } from '../lib/icons.js';
import { registerModal } from '../lib/modal-state.js';

export const SEARCH_HISTORY_KEY = 'flaxia_search_history';
const MAX_HISTORY = 8;

type PaletteKind = 'action' | 'tag' | 'user' | 'history' | 'search';

interface PaletteItem {
  kind: PaletteKind;
  label: string;
  sub?: string;
  avatarInitial?: string;
  actionIcon?: IconName;
  run: () => void;
}

interface PaletteSection {
  title: string;
  items: PaletteItem[];
}

interface SuggestTag {
  tag: string;
  count: number;
}

interface SuggestUser {
  username: string;
  display_name?: string;
  avatar_key?: string;
}

function spaGo(path: string, detail: Record<string, unknown>): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new CustomEvent('spaNavigate', { detail }));
}

function goTag(tag: string): void {
  spaGo(`/explore?tag=${encodeURIComponent(tag)}`, { view: 'explore', tag });
}

function goUser(username: string): void {
  spaGo(`/profile/${encodeURIComponent(username)}`, { view: 'profile', username });
}

function goSearch(query: string): void {
  saveSearchHistory(query);
  spaGo(`/search?q=${encodeURIComponent(query)}&type=posts`, {
    view: 'search',
    searchQuery: query,
    searchType: 'posts',
  });
}

export function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]).slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

export function saveSearchHistory(query: string): void {
  const q = query.trim();
  if (!q) return;
  const history = getSearchHistory().filter((h) => h !== q);
  history.unshift(q);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

interface PaletteActionDef {
  id: string;
  iconName: IconName;
  path: string;
  detail: Record<string, unknown>;
}

function actionDefs(): PaletteActionDef[] {
  return [
    { id: 'command_palette.go_home', iconName: 'home', path: '/home', detail: { view: 'timeline' } },
    { id: 'command_palette.go_explore', iconName: 'explore', path: '/explore', detail: { view: 'explore' } },
    { id: 'command_palette.go_arcade', iconName: 'arcade', path: '/arcade', detail: { view: 'arcade' } },
    {
      id: 'command_palette.go_notifications',
      iconName: 'notifications',
      path: '/notifications',
      detail: { view: 'notifications' },
    },
    {
      id: 'command_palette.go_bookmarks',
      iconName: 'bookmark',
      path: '/bookmarks',
      detail: { view: 'bookmarks' },
    },
    {
      id: 'command_palette.go_settings',
      iconName: 'settings',
      path: '/settings',
      detail: { view: 'settings' },
    },
  ];
}

/**
 * Obsidian-style command palette: fuzzy jump-to-actions, tags, people,
 * and full-text search behind a single ⌘K. Custom implementation —
 * no dependency, SPA-native (never reloads).
 */
export function openCommandPalette(initialQuery = ''): void {
  if (document.querySelector('.cmd-palette-overlay')) return;
  const unregister = registerModal();

  const overlay = document.createElement('div');
  overlay.className = 'playroom-overlay cmd-palette-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'cmd-palette';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', t('command_palette.title'));

  // ── Input row ──
  const inputRow = document.createElement('div');
  inputRow.className = 'cmd-palette-input-row';
  const searchIcon = document.createElement('span');
  searchIcon.className = 'cmd-palette-input-icon';
  searchIcon.appendChild(icon('search'));
  const input = document.createElement('input');
  input.className = 'cmd-palette-input';
  input.type = 'text';
  input.placeholder = t('command_palette.placeholder');
  input.value = initialQuery;
  input.setAttribute('aria-label', t('command_palette.placeholder'));
  const escHint = document.createElement('kbd');
  escHint.className = 'cmd-kbd';
  escHint.textContent = 'esc';
  inputRow.appendChild(searchIcon);
  inputRow.appendChild(input);
  inputRow.appendChild(escHint);

  // ── Results ──
  const list = document.createElement('div');
  list.className = 'cmd-palette-list';
  list.setAttribute('role', 'listbox');

  // ── Footer hints ──
  const footer = document.createElement('div');
  footer.className = 'cmd-palette-footer';
  const hints: Array<[string, string]> = [
    ['↑↓', t('command_palette.hint_move')],
    ['↵', t('command_palette.hint_open')],
    ['esc', t('command_palette.hint_close')],
  ];
  for (const [key, label] of hints) {
    const hint = document.createElement('span');
    hint.className = 'cmd-palette-hint';
    const kbd = document.createElement('kbd');
    kbd.className = 'cmd-kbd';
    kbd.textContent = key;
    hint.appendChild(kbd);
    hint.appendChild(document.createTextNode(label));
    footer.appendChild(hint);
  }

  dialog.appendChild(inputRow);
  dialog.appendChild(list);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  let sections: PaletteSection[] = [];
  let flat: Array<{ item: PaletteItem; el: HTMLElement }> = [];
  let activeIndex = -1;
  let seq = 0;
  const aborters = new Set<AbortController>();
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const c of aborters) c.abort();
    aborters.clear();
    unregister();
    overlay.remove();
  };

  const setActive = (index: number, scroll = true): void => {
    activeIndex = index;
    for (const [i, entry] of flat.entries()) {
      entry.el.classList.toggle('is-active', i === index);
      if (i === index && scroll) {
        entry.el.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  const runActive = (): void => {
    const entry = flat[activeIndex];
    if (!entry) return;
    const run = entry.item.run;
    close();
    run();
  };

  const renderRow = (item: PaletteItem): HTMLElement => {
    const row = document.createElement('div');
    row.className = `cmd-row cmd-row--${item.kind}`;
    row.setAttribute('role', 'option');

    const glyph = document.createElement('span');
    glyph.className = 'cmd-row-glyph';
    if (item.kind === 'user') {
      glyph.classList.add('cmd-avatar');
      glyph.textContent = item.avatarInitial ?? '?';
    } else if (item.kind === 'tag') {
      glyph.classList.add('cmd-hash');
      glyph.textContent = '#';
    } else if (item.actionIcon) {
      glyph.appendChild(icon(item.actionIcon, { width: '16', height: '16' }));
    } else {
      glyph.appendChild(icon('search', { width: '16', height: '16' }));
    }

    const texts = document.createElement('span');
    texts.className = 'cmd-row-texts';
    const label = document.createElement('span');
    label.className = 'cmd-row-label';
    label.textContent = item.label;
    texts.appendChild(label);
    if (item.sub) {
      const sub = document.createElement('span');
      sub.className = 'cmd-row-sub';
      sub.textContent = item.sub;
      texts.appendChild(sub);
    }

    row.appendChild(glyph);
    row.appendChild(texts);
    return row;
  };

  const render = (): void => {
    list.innerHTML = '';
    flat = [];
    if (sections.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmd-empty';
      empty.textContent = t('command_palette.no_results');
      list.appendChild(empty);
      activeIndex = -1;
      return;
    }
    for (const section of sections) {
      if (section.items.length === 0) continue;
      const head = document.createElement('div');
      head.className = 'cmd-section-title';
      head.textContent = section.title;
      list.appendChild(head);
      for (const item of section.items) {
        const el = renderRow(item);
        const index = flat.length;
        el.addEventListener('mouseenter', () => setActive(index, false));
        el.addEventListener('click', runActive);
        list.appendChild(el);
        flat.push({ item, el });
      }
    }
    setActive(flat.length > 0 ? 0 : -1, false);
  };

  const fetchJson = async <T>(url: string, mySeq: number): Promise<T | null> => {
    const controller = new AbortController();
    aborters.add(controller);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok || mySeq !== seq) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    } finally {
      aborters.delete(controller);
    }
  };

  const buildSections = async (query: string, mySeq: number): Promise<void> => {
    const q = query.trim();

    // Matching jump-to actions always participate.
    const lowered = q.toLowerCase();
    const actions: PaletteItem[] = actionDefs()
      .filter((a) => !lowered || t(a.id).toLowerCase().includes(lowered))
      .slice(0, 6)
      .map((a) => ({
        kind: 'action' as PaletteKind,
        label: t(a.id),
        actionIcon: a.iconName,
        run: () => spaGo(a.path, a.detail),
      }));

    if (!q) {
      const history: PaletteItem[] = getSearchHistory().map((h) => ({
        kind: 'history' as PaletteKind,
        label: h,
        run: () => goSearch(h),
      }));
      sections = [
        ...(history.length > 0 ? [{ title: t('command_palette.recent'), items: history }] : []),
        { title: t('command_palette.actions'), items: actions },
      ];
      if (mySeq === seq) render();
      return;
    }

    if (q.startsWith('#')) {
      const prefix = q.slice(1);
      const data = await fetchJson<{ tags: SuggestTag[] }>(`/api/tags/suggest?q=${encodeURIComponent(prefix)}`, mySeq);
      if (mySeq !== seq) return;
      sections = [
        {
          title: t('command_palette.tags'),
          items: (data?.tags || []).slice(0, 7).map((tg) => ({
            kind: 'tag' as PaletteKind,
            label: `#${tg.tag}`,
            sub: `${tg.count}`,
            run: () => goTag(tg.tag),
          })),
        },
      ];
      render();
      return;
    }

    if (q.startsWith('@')) {
      const prefix = q.slice(1);
      const data = await fetchJson<{ users: SuggestUser[] }>(
        `/api/users/suggest?q=${encodeURIComponent(prefix)}`,
        mySeq,
      );
      if (mySeq !== seq) return;
      sections = [
        {
          title: t('command_palette.people'),
          items: (data?.users || []).slice(0, 7).map((u) => ({
            kind: 'user' as PaletteKind,
            label: `@${u.username}`,
            sub: u.display_name || undefined,
            avatarInitial: (u.display_name || u.username || '?')[0]?.toUpperCase(),
            run: () => goUser(u.username),
          })),
        },
      ];
      render();
      return;
    }

    // Plain text: full-text search first, then tag + people suggestions.
    const searchItem: PaletteItem = {
      kind: 'search',
      label: t('command_palette.search_for', { query: q }),
      actionIcon: 'search',
      run: () => goSearch(q),
    };
    const [tagData, userData] = await Promise.all([
      fetchJson<{ tags: SuggestTag[] }>(`/api/tags/suggest?q=${encodeURIComponent(q)}`, mySeq),
      fetchJson<{ users: SuggestUser[] }>(`/api/users/suggest?q=${encodeURIComponent(q)}`, mySeq),
    ]);
    if (mySeq !== seq) return;
    sections = [
      { title: t('command_palette.search'), items: [searchItem] },
      {
        title: t('command_palette.tags'),
        items: (tagData?.tags || []).slice(0, 4).map((tg) => ({
          kind: 'tag' as PaletteKind,
          label: `#${tg.tag}`,
          sub: `${tg.count}`,
          run: () => goTag(tg.tag),
        })),
      },
      {
        title: t('command_palette.people'),
        items: (userData?.users || []).slice(0, 4).map((u) => ({
          kind: 'user' as PaletteKind,
          label: `@${u.username}`,
          sub: u.display_name || undefined,
          avatarInitial: (u.display_name || u.username || '?')[0]?.toUpperCase(),
          run: () => goUser(u.username),
        })),
      },
      ...(actions.length > 0 ? [{ title: t('command_palette.actions'), items: actions }] : []),
    ];
    render();
  };

  let debounce: ReturnType<typeof setTimeout> | null = null;
  const refresh = (): void => {
    seq += 1;
    const mySeq = seq;
    if (debounce) clearTimeout(debounce);
    const q = input.value;
    if (!q.trim()) {
      void buildSections(q, mySeq);
      return;
    }
    debounce = setTimeout(() => void buildSections(q, mySeq), 180);
  };

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length > 0) setActive((activeIndex + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length > 0) setActive((activeIndex - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  // Initial paint: recent searches + jump-to actions.
  void buildSections(initialQuery, seq);
  requestAnimationFrame(() => input.focus());
}
