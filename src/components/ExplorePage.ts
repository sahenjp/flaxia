import { attachPlusBadge } from '../lib/avatar.js';
import { createFabButton } from '../lib/fab-button.js';
import { formatCount } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { createInfiniteScroll } from '../lib/infinite-scroll.js';
import { createSkeletonCards } from '../lib/loading-ui.js';
import { createPageHeader } from '../lib/page-header.js';
import { openPostModal } from '../lib/post-modal.js';
import { createPostUpdatedHandler } from '../lib/post-update.js';
import { updateMetaTags } from '../lib/seo-meta.js';
import { Post } from '../types/post.js';
import { openCommandPalette } from './CommandPalette.js';
import { createPostCard } from './PostCard.js';
import { createTagConstellation } from './TagConstellation.js';

export interface ExplorePageProps {
  tag?: string;
  sandboxOrigin: string;
  currentUser?: { username: string; id: string; display_name?: string; avatar_key?: string } | null;
}

interface ArcadeGame {
  id: string;
  postId: string;
  title: string;
  username: string;
  displayName?: string;
  avatarKey?: string;
  type: string;
  swfKey?: string;
  payloadKey?: string;
  thumbnailKey?: string;
  freshCount: number;
  replyCount: number;
  impressions: number;
  isFreshed: boolean;
  createdAt: string;
}
export class ExplorePage {
  private element: HTMLElement;
  private props: ExplorePageProps;
  private posts: Post[] = [];
  private arcadePosts: ArcadeGame[] = [];
  private userSuggestions: Array<{
    id: string;
    username: string;
    display_name?: string;
    avatar_key?: string;
    badge_type?: string | null;
    bio?: string;
  }> = [];
  private cursor?: string;
  private loading = false;
  private hasMore = true;
  private infiniteScroll: ReturnType<typeof createInfiniteScroll>;
  private activeFilter: 'posts' | 'arcade' | 'users' = 'posts';
  private fabButton: HTMLElement | null = null;
  private tagCountEl: HTMLElement | null = null;
  private totalTagCount: number = 0;
  private postCards: Map<string, ReturnType<typeof createPostCard>> = new Map();
  private postUpdatedHandler?: (e: Event) => void;
  private constellation?: { element: HTMLElement; destroy: () => void };

  constructor(props: ExplorePageProps) {
    this.props = props;
    this.infiniteScroll = createInfiniteScroll({
      onLoadMore: () => this.loadMorePosts(),
      canLoadMore: () => !this.loading && this.hasMore,
    });
    this.element = this.createElement();
    this.setupEventListeners();
    this.setupPostUpdatedListener();
    this.loadContent();

    if (props.tag) {
      updateMetaTags({
        title: `Flaxia - #${props.tag}`,
        description: `Explore posts tagged #${props.tag} on Flaxia`,
        url: `${window.location.origin}/explore?tag=${encodeURIComponent(props.tag)}`,
      });
    }
  }

  private createElement(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'explore-page';

    // Add search section
    const searchSection = this.createSearchSection();
    container.appendChild(searchSection);

    // 'posts' button is set as active by default in createSearchSection

    if (this.props.tag) {
      container.appendChild(
        createPageHeader({
          title: `#${this.props.tag}`,
          subtitle: t('explore.tag_count', { count: formatCount(0) }),
          subtitleRef: (el) => {
            this.tagCountEl = el;
          },
          onBack: () => window.history.back(),
        }),
      );

      const postsContainer = document.createElement('div');
      postsContainer.className = 'explore-posts';
      container.appendChild(postsContainer);
    } else {
      const contentContainer = document.createElement('div');
      contentContainer.className = 'explore-content';

      const trendingTagsContainer = document.createElement('div');
      trendingTagsContainer.className = 'explore-trending-tags';
      contentContainer.appendChild(trendingTagsContainer);

      const postsContainer = document.createElement('div');
      postsContainer.className = 'explore-posts';
      contentContainer.appendChild(postsContainer);

      container.appendChild(contentContainer);
    }

    // Add loading container
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'explore-loading';
    loadingContainer.style.cssText = 'display: none;';
    container.appendChild(loadingContainer);

    container.appendChild(this.infiniteScroll.sentinel);
    this.infiniteScroll.sentinel.style.marginTop = '1rem';

    if (this.props.currentUser) {
      this.fabButton = createFabButton(() => {
        openPostModal({
          currentUser: this.props.currentUser,
          onPostCreated: (post) => this.handleNewPost(post as unknown as Post),
        });
      }, true);
      container.appendChild(this.fabButton);
    }

    return container;
  }

  private createSearchSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'explore-search-section';

    const searchBox = document.createElement('div');
    searchBox.className = 'explore-search-box';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'palette-trigger';
    trigger.setAttribute('aria-label', t('explore.open_search'));

    const iconWrap = document.createElement('span');
    iconWrap.className = 'search-icon';
    iconWrap.appendChild(icon('search'));

    const label = document.createElement('span');
    label.className = 'palette-trigger-label';
    label.textContent = t('explore.open_search');

    const kbd = document.createElement('kbd');
    kbd.className = 'cmd-kbd palette-trigger-kbd';
    kbd.textContent = '\u2318K';

    trigger.appendChild(iconWrap);
    trigger.appendChild(label);
    trigger.appendChild(kbd);
    trigger.addEventListener('click', () => openCommandPalette());
    searchBox.appendChild(trigger);

    section.appendChild(searchBox);

    // Filter bar
    const filterBar = document.createElement('div');
    filterBar.className = 'explore-filter-bar';

    const filters: { key: 'posts' | 'arcade' | 'users'; label: string }[] = [
      { key: 'posts', label: t('explore.filter_posts') },
      { key: 'arcade', label: t('explore.filter_arcade') },
      { key: 'users', label: t('explore.filter_users') },
    ];

    for (const f of filters) {
      const btn = document.createElement('button');
      btn.className = `explore-filter-btn${f.key === 'posts' ? ' is-active' : ''}`;
      btn.dataset.filter = f.key;
      btn.textContent = f.label;
      btn.onclick = () => this.switchFilter(f.key);
      filterBar.appendChild(btn);
    }

    section.appendChild(filterBar);

    return section;
  }

  private setupEventListeners(): void {
    // Search moved to the global command palette (palette trigger above).
  }

  private async loadContent(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.updateLoadingState(true);

    try {
      if (this.props.tag) {
        await this.loadTagPosts();
      } else {
        switch (this.activeFilter) {
          case 'posts':
            await this.loadTrendingContent();
            break;
          case 'arcade':
            await this.loadArcadeContent();
            break;
          case 'users':
            await this.loadUsersContent();
            break;
        }
      }
    } catch (error) {
      console.error('Failed to load explore content:', error);
    } finally {
      this.loading = false;
      this.updateLoadingState(false);
    }
  }

  private async loadMorePosts(): Promise<void> {
    if (this.loading || !this.hasMore) return;

    this.loading = true;
    this.updateLoadingState(true);

    try {
      let url = '';
      if (this.props.tag) {
        url = `/api/posts?hashtag=${encodeURIComponent(this.props.tag)}&limit=10`;
      } else if (this.activeFilter === 'arcade') {
        url = `/api/games?limit=10`;
      } else {
        url = `/api/posts/trending?limit=10`;
      }

      if (this.cursor) {
        if (this.props.tag) {
          url += `&cursor=${encodeURIComponent(this.cursor)}`;
        } else if (this.activeFilter === 'arcade') {
          url += `&cursor=${encodeURIComponent(this.cursor)}`;
        } else if (this.cursor.includes(',')) {
          url += `&cursor=${encodeURIComponent(this.cursor)}`;
        } else {
          this.cursor = undefined;
        }
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load more posts');

      if (this.activeFilter === 'arcade') {
        const data = (await response.json()) as { games: ArcadeGame[]; hasMore: boolean; cursor?: string | null };
        const newPosts = data.games || [];
        if (newPosts.length > 0) {
          this.arcadePosts.push(...newPosts);
          this.cursor = data.cursor ?? undefined;
          this.hasMore = data.hasMore;
          this.renderArcadePosts();
        } else {
          this.hasMore = false;
          this.showEndOfPosts();
        }
      } else {
        const data = (await response.json()) as { posts: Post[] };
        const newPosts = data.posts || [];

        if (newPosts.length > 0) {
          this.posts.push(...newPosts);
          if (!this.props.tag) {
            const lastPost = newPosts[newPosts.length - 1] as Post & { score: number };
            this.cursor = `${lastPost.score},${lastPost.created_at}`;
          } else {
            this.cursor = newPosts[newPosts.length - 1].created_at;
          }
          this.hasMore = newPosts.length === 10;
          this.renderPosts();
        } else {
          this.hasMore = false;
          this.showEndOfPosts();
        }
      }
    } catch (error) {
      console.error('Failed to load more posts:', error);
      this.showLoadError();
    } finally {
      this.loading = false;
      this.updateLoadingState(false);
    }
  }

  private async loadTagPosts(): Promise<void> {
    let url = `/api/posts?hashtag=${encodeURIComponent(this.props.tag!)}&limit=10`;
    if (this.cursor) {
      url += `&cursor=${encodeURIComponent(this.cursor)}`;
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load tag posts');
    const data = (await response.json()) as { posts: Post[]; count?: number };
    if (data.count !== undefined) {
      this.totalTagCount = data.count;
    }
    this.handleNewPosts(data.posts);
  }

  private async loadTrendingContent(): Promise<void> {
    // Load both trending tags and trending posts
    const [tagsRes, postsRes] = await Promise.all([fetch('/api/tags/trending'), fetch('/api/posts/trending?limit=10')]);

    if (tagsRes.ok) {
      const tagsData = (await tagsRes.json()) as { tags: Array<{ tag: string; percentage: string }> };
      this.renderTrendingTags(tagsData.tags || []);
    }

    if (postsRes.ok) {
      const postsData = (await postsRes.json()) as { posts: Post[] };
      this.handleNewPosts(postsData.posts || []);
    }
  }

  private async loadArcadeContent(): Promise<void> {
    const res = await fetch('/api/games?limit=10');
    if (res.ok) {
      const data = (await res.json()) as { games: ArcadeGame[]; hasMore: boolean; cursor?: string | null };
      this.arcadePosts = data.games || [];
      this.cursor = data.cursor ?? undefined;
      this.hasMore = data.hasMore;
      this.renderArcadePosts();
    }
  }

  private async loadUsersContent(): Promise<void> {
    const res = await fetch('/api/users/suggestions');
    if (res.ok) {
      const data = (await res.json()) as {
        users: Array<{
          id: string;
          username: string;
          display_name?: string;
          avatar_key?: string;
          badge_type?: string | null;
          bio?: string;
        }>;
      };
      this.userSuggestions = data.users || [];
      this.hasMore = false;
      this.renderUserSuggestions();
    }
  }

  private handleNewPosts(newPosts: Post[]): void {
    if (newPosts.length > 0) {
      this.posts.push(...newPosts);
      this.cursor = newPosts[newPosts.length - 1].created_at;
      this.hasMore = newPosts.length === 10;
      this.renderPosts();
    } else {
      this.hasMore = false;
      if (this.posts.length > 0) this.showEndOfPosts();
    }
    this.updateTagCount();
  }

  private switchFilter(filter: 'posts' | 'arcade' | 'users'): void {
    if (this.activeFilter === filter) return;
    this.activeFilter = filter;

    // Update filter UI
    const filterBtns = this.element.querySelectorAll('.explore-filter-btn') as NodeListOf<HTMLElement>;
    filterBtns.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.filter === filter);
    });

    // Show/hide trending tags container
    const trendingTags = this.element.querySelector('.explore-trending-tags') as HTMLElement;
    if (trendingTags) {
      trendingTags.style.display = filter === 'posts' ? 'block' : 'none';
    }

    // Reset and load content for the new filter
    const postsContainer = this.element.querySelector('.explore-posts') as HTMLElement;
    if (postsContainer) {
      postsContainer.innerHTML = '';
    }

    // If in tag view, tag view only shows posts
    if (this.props.tag && filter !== 'posts') {
      const loadingElement = this.element.querySelector('.explore-loading') as HTMLElement;
      if (loadingElement) {
        loadingElement.style.display = 'block';
        loadingElement.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'search-empty';
        msg.textContent = t('explore.tag_filter_unavailable');
        loadingElement.appendChild(msg);
      }
      return;
    }

    this.posts = [];
    this.arcadePosts = [];
    this.userSuggestions = [];
    this.cursor = undefined;
    this.hasMore = true;
    this.postCards.clear();

    void this.loadContent();
  }

  private setupPostUpdatedListener(): void {
    this.postUpdatedHandler = createPostUpdatedHandler(this.postCards);
    window.addEventListener('postUpdated', this.postUpdatedHandler);
  }

  private renderPosts(): void {
    const postsContainer = this.element.querySelector('.explore-posts') as HTMLElement;
    if (!postsContainer) return;

    // If initial load, clear container
    if (this.posts.length <= 10 && postsContainer.children.length > 0 && !this.cursor) {
      postsContainer.innerHTML = '';
      this.postCards.clear();
    }

    const fragment = document.createDocumentFragment();
    const startIndex = postsContainer.children.length;

    this.posts.slice(startIndex).forEach((post) => {
      const postCard = createPostCard({
        post,
        sandboxOrigin: this.props.sandboxOrigin,
        currentUser: this.props.currentUser || undefined,
        depth: post.depth,
      });
      this.postCards.set(post.id, postCard);
      fragment.appendChild(postCard.getElement());
    });

    postsContainer.appendChild(fragment);
  }

  private renderTrendingTags(tags: Array<{ tag: string; count?: number; percentage: string }>): void {
    const container = this.element.querySelector('.explore-trending-tags') as HTMLElement;
    if (!container) return;

    this.constellation?.destroy();
    this.constellation = undefined;
    container.innerHTML = '';
    container.className = 'explore-trending-tags';
    container.style.display = 'block';

    const openTag = (tag: string): void => {
      window.history.pushState({}, '', `/explore?tag=${encodeURIComponent(tag)}`);
      window.dispatchEvent(new CustomEvent('spaNavigate', { detail: { view: 'explore', tag } }));
    };

    const heading = document.createElement('h2');
    heading.className = 'explore-trending-heading';
    heading.textContent = t('explore.trending_tags');
    container.appendChild(heading);

    if (tags.length > 0) {
      this.constellation = createTagConstellation(tags, openTag);
      container.appendChild(this.constellation.element);
      const hint = document.createElement('div');
      hint.className = 'constellation-hint';
      hint.textContent = t('explore.graph_hint');
      const hintWrap = document.createElement('div');
      hintWrap.className = 'constellation-wrap';
      hintWrap.appendChild(hint);
      container.appendChild(hintWrap);
    }

    const maxCount = Math.max(1, ...tags.map((entry) => (typeof entry.count === 'number' ? entry.count : 0)));

    tags.forEach(({ tag, count, percentage }, index) => {
      const item = document.createElement('div');
      item.className = 'trending-item';
      item.style.setProperty('--i', String(Math.min(index, 7)));
      item.setAttribute('role', 'link');
      item.setAttribute('tabindex', '0');

      const rank = document.createElement('span');
      rank.className = 'trending-rank';
      rank.textContent = String(index + 1).padStart(2, '0');

      const body = document.createElement('div');
      body.className = 'trending-body';

      const hashtag = document.createElement('div');
      hashtag.className = 'trending-hashtag';
      hashtag.textContent = `#${tag}`;

      const meta = document.createElement('div');
      meta.className = 'trending-meta';
      const parts = [t('explore.trending_percent', { percentage })];
      if (count === 1) {
        parts.push(t('right_panel.trending_post_one'));
      } else if (typeof count === 'number' && count > 0) {
        parts.push(t('right_panel.trending_posts', { count }));
      }
      meta.textContent = parts.join(' · ');

      const bar = document.createElement('div');
      bar.className = 'trending-bar';
      const fill = document.createElement('span');
      fill.style.width = `${Math.max(6, Math.round(((count || 0) / maxCount) * 100))}%`;
      bar.appendChild(fill);

      body.appendChild(hashtag);
      body.appendChild(meta);
      body.appendChild(bar);
      item.appendChild(rank);
      item.appendChild(body);

      item.addEventListener('click', () => openTag(tag));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openTag(tag);
        }
      });
      container.appendChild(item);
    });
  }

  private renderArcadePosts(): void {
    const postsContainer = this.element.querySelector('.explore-posts') as HTMLElement;
    if (!postsContainer) return;

    if (this.arcadePosts.length === postsContainer.children.length && postsContainer.children.length > 0) {
      return;
    }

    if (postsContainer.children.length === 0 || this.arcadePosts.length <= postsContainer.children.length) {
      if (this.arcadePosts.length <= 10) {
        postsContainer.innerHTML = '';
      }
    }

    const fragment = document.createDocumentFragment();
    const startIndex = postsContainer.children.length;

    this.arcadePosts.slice(startIndex).forEach((game) => {
      const row = document.createElement('div');
      row.className = 'explore-arcade-row';
      row.onclick = () => {
        window.history.pushState({ postId: game.postId }, '', `/arcade/${game.postId}`);
        window.dispatchEvent(new CustomEvent('spaNavigate', { detail: { view: 'arcade', postId: game.postId } }));
      };

      const thumb = document.createElement('div');
      thumb.className = 'arcade-row-thumb arcade-row-thumb--secondary';

      if (game.thumbnailKey) {
        const img = document.createElement('img');
        img.className = 'arcade-row-img';
        img.src = `/api/thumbnail/${game.postId}`;
        img.alt = '';
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

      const info = document.createElement('div');
      info.className = 'arcade-row-info';

      const title = document.createElement('div');
      title.className = 'arcade-row-title';
      title.textContent = game.title;

      const meta = document.createElement('div');
      meta.className = 'arcade-row-meta';

      const author = document.createElement('span');
      author.textContent = `@${game.username}`;

      const engagement = document.createElement('span');
      const freshStr = Number.isNaN(game.freshCount) ? '0' : formatCount(game.freshCount);
      engagement.textContent = `${freshStr} 💚`;

      meta.appendChild(author);
      meta.appendChild(engagement);
      info.appendChild(title);
      info.appendChild(meta);

      row.appendChild(thumb);
      row.appendChild(info);
      fragment.appendChild(row);
    });

    postsContainer.appendChild(fragment);
  }

  private renderUserSuggestions(): void {
    const postsContainer = this.element.querySelector('.explore-posts') as HTMLElement;
    if (!postsContainer) return;
    postsContainer.innerHTML = '';

    if (this.userSuggestions.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'search-empty';
      msg.textContent = t('explore.no_users');
      postsContainer.appendChild(msg);
      return;
    }

    this.userSuggestions.forEach((user) => {
      const item = document.createElement('div');
      item.className = 'search-user-row';
      item.onclick = () => {
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
      item.appendChild(avatar);
      item.appendChild(userInfo);
      postsContainer.appendChild(item);
    });
  }

  private updateLoadingState(isLoading: boolean): void {
    const loadingElement = this.element.querySelector('.explore-loading') as HTMLElement;
    if (loadingElement) {
      loadingElement.style.display = isLoading ? 'block' : 'none';
      if (isLoading) {
        loadingElement.innerHTML = '';
        loadingElement.appendChild(createSkeletonCards(2));
      }
    }
  }

  private showEndOfPosts(): void {
    const loadingElement = this.element.querySelector('.explore-loading') as HTMLElement;
    if (loadingElement) {
      loadingElement.style.display = 'block';
      loadingElement.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'explore-end';

      const endIcon = document.createElement('div');
      endIcon.className = 'explore-end-icon';
      endIcon.textContent = t('explore.end_icon');

      const title = document.createElement('div');
      title.className = 'explore-end-title';
      title.textContent = t('explore.end_message');

      const subtitle = document.createElement('div');
      subtitle.className = 'explore-end-subtitle';
      subtitle.textContent = t('explore.end_subtitle', { tag: this.props.tag ?? '' });

      wrapper.appendChild(endIcon);
      wrapper.appendChild(title);
      wrapper.appendChild(subtitle);
      loadingElement.appendChild(wrapper);
    }
  }

  private showLoadError(): void {
    const loadingElement = this.element.querySelector('.explore-loading') as HTMLElement;
    if (loadingElement) {
      loadingElement.style.display = 'block';
      loadingElement.innerHTML = '';

      const wrapper = document.createElement('div');
      wrapper.className = 'explore-end';

      const errIcon = document.createElement('div');
      errIcon.className = 'explore-end-icon';
      errIcon.textContent = '⚠️';

      const title = document.createElement('div');
      title.className = 'explore-end-title';
      title.textContent = t('explore.load_error');

      const retryBtn = document.createElement('button');
      retryBtn.className = 'explore-retry-btn';
      retryBtn.textContent = t('common.retry');
      retryBtn.addEventListener('click', () => {
        loadingElement.style.display = 'none';
        void this.loadMorePosts();
      });

      wrapper.appendChild(errIcon);
      wrapper.appendChild(title);
      wrapper.appendChild(retryBtn);
      loadingElement.appendChild(wrapper);
    }
  }

  private handleNewPost(post: Post): void {
    this.posts = [post, ...this.posts];
    const postsContainer = this.element.querySelector('.explore-posts') as HTMLElement;
    if (postsContainer) {
      postsContainer.insertBefore(
        createPostCard({
          post,
          sandboxOrigin: this.props.sandboxOrigin,
          currentUser: this.props.currentUser || undefined,
        }).getElement(),
        postsContainer.firstChild,
      );
    }
    this.updateTagCount();
  }

  private updateTagCount(): void {
    if (this.tagCountEl && this.props.tag) {
      const count = this.totalTagCount || this.posts.length;
      this.tagCountEl.textContent = t('explore.tag_count', { count: formatCount(count) });
    }
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public destroy(): void {
    this.constellation?.destroy();
    this.constellation = undefined;
    if (this.postUpdatedHandler) {
      window.removeEventListener('postUpdated', this.postUpdatedHandler);
    }
    this.postCards.forEach((card) => void card.destroy());
    this.postCards.clear();
    this.infiniteScroll.disconnect();
  }
}

// Factory function for easier usage
export function createExplorePage(props: ExplorePageProps): ExplorePage {
  return new ExplorePage(props);
}
