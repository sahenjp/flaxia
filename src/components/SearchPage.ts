import { attachPlusBadge } from '../lib/avatar.js';
import { formatCount } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { Post, PostCardMode } from '../types/post.js';
import { createPostCard } from './PostCard.js';

interface SearchPageProps {
  query: string;
  type?: 'posts' | 'users' | 'arcade';
  currentUser: {
    username: string;
    id: string;
    display_name?: string;
    avatar_key?: string;
    badge_type?: string | null;
  } | null;
  sandboxOrigin: string;
}

export function createSearchPage({ query, type = 'posts', currentUser, sandboxOrigin }: SearchPageProps) {
  const initialFilter: 'all' | 'users' | 'posts' | 'arcade' =
    type === 'users' ? 'users' : type === 'arcade' ? 'arcade' : 'all';

  let activeFilter: 'all' | 'users' | 'posts' | 'arcade' = initialFilter;

  let allUsers: Array<{
    id: string;
    username: string;
    display_name?: string;
    avatar_key?: string;
    badge_type?: string | null;
    bio?: string;
    is_following?: boolean;
  }> = [];
  let allPosts: Post[] = [];
  let allArcade: Post[] = [];

  const container = document.createElement('div');
  container.className = 'search-page';

  // ── Header with search input ──
  const header = document.createElement('div');
  header.className = 'search-page-header';

  const backBtn = document.createElement('button');
  backBtn.className = 'search-page-back';
  backBtn.textContent = '←';
  backBtn.setAttribute('aria-label', 'Back');
  backBtn.addEventListener('click', () => {
    window.history.pushState({}, '', '/explore');
    window.dispatchEvent(new CustomEvent('spaNavigate', { detail: { view: 'explore' } }));
  });

  const searchBox = document.createElement('div');
  searchBox.className = 'search-page-box';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'search-input';
  input.value = query;
  input.placeholder = t('explore.search_placeholder');

  const iconDeco = document.createElement('span');
  iconDeco.className = 'search-icon-deco';
  iconDeco.appendChild(icon('search'));

  searchBox.appendChild(input);
  searchBox.appendChild(iconDeco);

  const suggestDropdown = document.createElement('div');
  suggestDropdown.className = 'tag-suggest-dropdown';
  searchBox.appendChild(suggestDropdown);

  header.appendChild(backBtn);
  header.appendChild(searchBox);
  container.appendChild(header);

  // ── Filter bar ──
  const filterBar = document.createElement('div');
  filterBar.className = 'search-filter-bar';
  // Calculate filter bar top based on actual header height
  requestAnimationFrame(() => {
    filterBar.style.top = `${header.offsetHeight}px`;
  });

  const filters: { key: 'all' | 'users' | 'posts' | 'arcade'; label: string }[] = [
    { key: 'all', label: t('search.filter_all') },
    { key: 'users', label: t('explore.filter_users') },
    { key: 'posts', label: t('explore.filter_posts') },
    { key: 'arcade', label: t('explore.filter_arcade') },
  ];

  const filterBtns: HTMLElement[] = [];

  const updateFilterUI = (activeKey: string) => {
    filterBtns.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.filter === activeKey);
    });
  };

  for (const f of filters) {
    const btn = document.createElement('button');
    btn.className = 'explore-filter-btn';
    btn.dataset.filter = f.key;
    btn.textContent = f.label;
    btn.onclick = () => {
      activeFilter = f.key;
      updateFilterUI(f.key);
      renderResults();
    };
    filterBtns.push(btn);
    filterBar.appendChild(btn);
  }

  updateFilterUI(activeFilter);
  container.appendChild(filterBar);

  // ── Content area ──
  const content = document.createElement('div');
  content.className = 'search-page-content';

  container.appendChild(content);

  // Loading state
  const loadingEl = document.createElement('div');
  loadingEl.className = 'search-loading';
  loadingEl.textContent = t('common.loading');
  content.appendChild(loadingEl);

  // ── Suggest helpers ──
  let suggestAbortController: AbortController | null = null;
  let suggestTimer: ReturnType<typeof setTimeout> | null = null;

  const fetchSuggestions = async (prefix: string, kind: 'tag' | 'user') => {
    if (suggestAbortController) suggestAbortController.abort();
    const controller = new AbortController();
    suggestAbortController = controller;
    try {
      const url =
        kind === 'tag'
          ? `/api/tags/suggest?q=${encodeURIComponent(prefix)}`
          : `/api/users/suggest?q=${encodeURIComponent(prefix)}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return;
      if (kind === 'tag') {
        const data = (await res.json()) as { tags: { tag: string; count: number }[] };
        renderSuggestions((data.tags || []).map((t) => ({ type: 'tag' as const, label: t.tag, count: t.count })));
      } else {
        const data = (await res.json()) as {
          users: { username: string; display_name: string; avatar_key: string; badge_type?: string | null }[];
        };
        renderSuggestions(
          (data.users || []).map((u) => ({
            type: 'user' as const,
            label: u.username,
            display: u.display_name,
            avatar: u.avatar_key,
            badge: u.badge_type ?? null,
          })),
        );
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== 'AbortError') console.error('Suggest error:', err);
    }
  };

  const renderSuggestions = (
    items: (
      | { type: 'tag'; label: string; count: number }
      | { type: 'user'; label: string; display: string; avatar: string; badge?: string | null }
    )[],
  ) => {
    suggestDropdown.innerHTML = '';
    if (items.length === 0) {
      suggestDropdown.style.display = 'none';
      return;
    }
    suggestDropdown.style.display = 'block';
    for (const it of items) {
      const item = document.createElement('div');
      item.className = 'suggest-item';
      if (it.type === 'tag') {
        const tagName = document.createElement('span');
        tagName.className = 'suggest-tag-name';
        tagName.textContent = `#${it.label}`;
        const count = document.createElement('span');
        count.className = 'suggest-count';
        count.textContent = formatCount(it.count);
        item.appendChild(tagName);
        item.appendChild(count);
        item.addEventListener('click', () => {
          suggestDropdown.style.display = 'none';
          window.history.pushState({}, '', `/explore?tag=${encodeURIComponent(it.label)}`);
          window.dispatchEvent(new CustomEvent('spaNavigate', { detail: { view: 'explore', tag: it.label } }));
        });
      } else {
        const avatar = document.createElement('div');
        avatar.className = 'suggest-avatar';
        avatar.textContent = (it.display || it.label)[0].toUpperCase();
        attachPlusBadge(avatar, it.badge);
        const info = document.createElement('div');
        info.className = 'suggest-info';
        const name = document.createElement('span');
        name.className = 'suggest-name';
        name.textContent = `@${it.label}`;
        const display = document.createElement('span');
        display.className = 'suggest-display';
        display.textContent = it.display;
        info.appendChild(name);
        info.appendChild(display);
        item.appendChild(avatar);
        item.appendChild(info);
        item.addEventListener('click', () => {
          suggestDropdown.style.display = 'none';
          window.history.pushState({}, '', `/profile/${encodeURIComponent(it.label)}`);
          window.dispatchEvent(new CustomEvent('spaNavigate', { detail: { view: 'profile', username: it.label } }));
        });
      }
      suggestDropdown.appendChild(item);
    }
  };

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      suggestAbortController?.abort();
      suggestDropdown.style.display = 'none';
      if (q.startsWith('#')) {
        const afterHash = q.slice(1).trim();
        const spaceIdx = afterHash.indexOf(' ');
        if (spaceIdx === -1 && afterHash) {
          window.history.pushState({}, '', `/explore?tag=${encodeURIComponent(afterHash)}`);
          window.dispatchEvent(new CustomEvent('spaNavigate', { detail: { view: 'explore', tag: afterHash } }));
          return;
        }
      }
      if (q && q !== query) {
        window.history.pushState({}, '', `/search?q=${encodeURIComponent(q)}&type=${type}`);
        window.dispatchEvent(
          new CustomEvent('spaNavigate', {
            detail: { view: 'search', searchQuery: q, searchType: type },
          }),
        );
      }
    }
  });

  input.addEventListener('input', () => {
    const val = input.value;
    if (suggestAbortController) suggestAbortController.abort();
    if (suggestTimer) clearTimeout(suggestTimer);
    if (val.length < 2 || val.includes(' ')) {
      suggestDropdown.style.display = 'none';
      return;
    }
    if (val.startsWith('#')) {
      const prefix = val.slice(1);
      if (!prefix) {
        suggestDropdown.style.display = 'none';
        return;
      }
      suggestTimer = setTimeout(() => fetchSuggestions(prefix, 'tag'), 200);
      return;
    }
    if (val.startsWith('@')) {
      const prefix = val.slice(1);
      if (!prefix) {
        suggestDropdown.style.display = 'none';
        return;
      }
      suggestTimer = setTimeout(() => fetchSuggestions(prefix, 'user'), 200);
      return;
    }
    suggestDropdown.style.display = 'none';
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      suggestDropdown.style.display = 'none';
    }, 200);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      suggestDropdown.style.display = 'none';
      input.blur();
    }
  });

  // ── Data fetching ──
  const loadSearchResults = async () => {
    try {
      const [postsRes, arcadeRes] = await Promise.all([
        fetch(`/api/search?q=${encodeURIComponent(query)}&type=posts&limit=20`),
        fetch(`/api/search?q=${encodeURIComponent(query)}&type=arcade&limit=20`),
      ]);
      const postsData = (await postsRes.json()) as {
        results: Post[];
        users?: Array<{
          id: string;
          username: string;
          display_name?: string;
          avatar_key?: string;
          badge_type?: string | null;
          bio?: string;
          is_following?: boolean;
        }>;
      };
      const arcadeData = (await arcadeRes.json()) as { results: Post[] };

      allUsers = postsData.users || [];
      allPosts = postsData.results || [];
      allArcade = arcadeData.results || [];

      content.removeChild(loadingEl);
      renderResults();
    } catch (error) {
      console.error('Search error:', error);
      if (loadingEl.parentNode === content) content.removeChild(loadingEl);
      const errorEl = document.createElement('div');
      errorEl.className = 'search-error';
      errorEl.textContent = t('common.error');
      content.appendChild(errorEl);
    }
  };

  // ── Rendering ──
  const renderResults = () => {
    content.innerHTML = '';

    const showAll = activeFilter === 'all';
    let anyVisible = false;

    // Users section
    if ((showAll || activeFilter === 'users') && allUsers.length > 0) {
      anyVisible = true;
      if (showAll) {
        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'search-section-title';
        sectionTitle.textContent = t('search.users');
        content.appendChild(sectionTitle);
      }
      renderUsers(allUsers);
      if (showAll && allArcade.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'search-divider';
        content.appendChild(divider);
      }
    }

    // Arcade section
    if ((showAll || activeFilter === 'arcade') && allArcade.length > 0) {
      anyVisible = true;
      if (showAll) {
        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'search-section-title';
        sectionTitle.textContent = t('explore.filter_arcade');
        content.appendChild(sectionTitle);
        renderArcade(allArcade, false);
      } else {
        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'search-section-title search-section-title--strong';
        sectionTitle.textContent = t('explore.filter_arcade');
        content.appendChild(sectionTitle);
        renderArcade(allArcade, true);
      }
      if (showAll && allPosts.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'search-divider';
        content.appendChild(divider);
      }
    }

    // Posts section
    if ((showAll || activeFilter === 'posts') && allPosts.length > 0) {
      anyVisible = true;
      if (showAll) {
        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'search-section-title';
        sectionTitle.textContent = t('search.posts');
        content.appendChild(sectionTitle);
      }
      renderPosts(allPosts);
    }

    if (!anyVisible) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = t('search.no_results', { query });
      content.appendChild(empty);
    }
  };

  const renderUsers = (
    users: Array<{
      id: string;
      username: string;
      display_name?: string;
      avatar_key?: string;
      badge_type?: string | null;
      bio?: string;
      is_following?: boolean;
    }>,
  ) => {
    users.forEach((user) => {
      const userItem = document.createElement('div');
      userItem.className = 'search-user-row';
      userItem.onclick = () => {
        window.history.pushState({ username: user.username }, '', `/profile/${user.username}`);
        window.dispatchEvent(new CustomEvent('spaNavigate', { detail: { view: 'profile', username: user.username } }));
      };

      const avatar = document.createElement('div');
      avatar.className = 'search-user-avatar';
      if (user.avatar_key) {
        avatar.style.backgroundImage = `url('/api/images/${user.avatar_key}')`;
      }
      if (!user.avatar_key) {
        avatar.textContent = user.display_name?.[0]?.toUpperCase() || user.username[0].toUpperCase();
      }
      attachPlusBadge(avatar, user.badge_type);

      const userInfo = document.createElement('div');
      userInfo.className = 'search-user-info';
      const usernameEl = document.createElement('div');
      usernameEl.className = 'search-user-name';
      usernameEl.textContent = `@${user.username}`;
      const displayNameEl = document.createElement('div');
      displayNameEl.className = 'search-user-display';
      displayNameEl.textContent = user.display_name || '';

      userInfo.appendChild(usernameEl);
      userInfo.appendChild(displayNameEl);
      userItem.appendChild(avatar);
      userItem.appendChild(userInfo);
      content.appendChild(userItem);
    });
  };

  const renderPosts = (posts: Post[]) => {
    posts.forEach((post) => {
      const postCard = createPostCard({
        post,
        currentUser,
        sandboxOrigin,
        initialMode: PostCardMode.PREVIEW,
        depth: post.depth,
      });
      content.appendChild(postCard.getElement());
    });
  };

  const renderArcade = (posts: Post[], grid: boolean) => {
    if (grid) {
      // YouTube-style horizontal list
      for (const post of posts) {
        const row = document.createElement('div');
        row.className = 'explore-arcade-row';
        row.onclick = () => {
          window.history.pushState({ postId: post.id }, '', `/arcade/${post.id}`);
          window.dispatchEvent(new CustomEvent('spaNavigate', { detail: { view: 'arcade', postId: post.id } }));
        };

        // Thumbnail (fixed width, 16:9 aspect ratio)
        const thumb = document.createElement('div');
        thumb.className = 'arcade-row-thumb';
        if (post.thumbnail_key) {
          const img = document.createElement('img');
          img.className = 'arcade-row-img';
          img.src = `/api/images/${post.thumbnail_key}?_=${Date.now()}`;
          img.loading = 'lazy';
          img.width = 180;
          img.height = 101;
          thumb.appendChild(img);
        } else {
          const fallback = document.createElement('span');
          fallback.className = 'arcade-row-fallback';
          fallback.appendChild(icon('arcade', { width: '24', height: '24' }));
          thumb.appendChild(fallback);
        }

        // Badge
        const badge = document.createElement('span');
        badge.className = 'arcade-row-badge';
        badge.textContent = 'GAME';
        thumb.appendChild(badge);

        // Details
        const details = document.createElement('div');
        details.className = 'arcade-row-info';

        const title = document.createElement('div');
        title.className = 'arcade-row-title';
        title.textContent = post.text || '(no title)';

        const meta = document.createElement('div');
        meta.className = 'arcade-row-meta';
        meta.textContent = `@${post.username}`;

        details.appendChild(title);
        details.appendChild(meta);
        row.appendChild(thumb);
        row.appendChild(details);
        content.appendChild(row);
      }
    } else {
      // Horizontal scroll cards
      const wrapper = document.createElement('div');
      wrapper.className = 'search-arcade-strip';

      const scrollContainer = document.createElement('div');
      scrollContainer.className = 'search-arcade-track';
      scrollContainer.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
          e.preventDefault();
          scrollContainer.scrollLeft += e.deltaY;
        }
      });

      // Right-edge fade hint
      const fadeHint = document.createElement('div');
      fadeHint.className = 'search-arcade-fade';
      wrapper.appendChild(fadeHint);

      const updateFade = () => {
        const atEnd = scrollContainer.scrollLeft >= scrollContainer.scrollWidth - scrollContainer.clientWidth - 4;
        fadeHint.style.opacity = atEnd ? '0' : '1';
      };
      scrollContainer.addEventListener('scroll', updateFade);

      for (const post of posts) {
        const card = document.createElement('div');
        card.className = 'search-arcade-card';
        card.onclick = () => {
          window.history.pushState({ postId: post.id }, '', `/arcade/${post.id}`);
          window.dispatchEvent(new CustomEvent('spaNavigate', { detail: { view: 'arcade', postId: post.id } }));
        };

        // Thumbnail
        const thumb = document.createElement('div');
        thumb.className = 'search-arcade-thumb';
        if (post.thumbnail_key) {
          const img = document.createElement('img');
          img.className = 'arcade-row-img';
          img.src = `/api/images/${post.thumbnail_key}?_=${Date.now()}`;
          img.loading = 'lazy';
          img.width = 150;
          img.height = 200;
          thumb.appendChild(img);
        } else {
          const fallback = document.createElement('span');
          fallback.className = 'arcade-row-fallback';
          fallback.appendChild(icon('arcade', { width: '32', height: '32' }));
          thumb.appendChild(fallback);
        }

        // Badge
        const badge = document.createElement('span');
        badge.className = 'arcade-row-badge';
        badge.textContent = 'GAME';
        thumb.appendChild(badge);

        // Info
        const info = document.createElement('div');
        info.className = 'search-arcade-info';

        const title = document.createElement('div');
        title.className = 'search-arcade-title';
        title.textContent = post.text?.slice(0, 60) || '(no text)';

        const meta = document.createElement('div');
        meta.className = 'search-arcade-meta';
        meta.textContent = `@${post.username}`;

        info.appendChild(title);
        info.appendChild(meta);
        card.appendChild(thumb);
        card.appendChild(info);
        scrollContainer.appendChild(card);
      }

      wrapper.appendChild(scrollContainer);
      content.appendChild(wrapper);

      // Initial fade state
      requestAnimationFrame(updateFade);
    }
  };

  // Start
  loadSearchResults();

  return {
    getElement: () => container,
    destroy: () => {
      container.remove();
    },
  };
}
