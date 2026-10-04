import { attachPlusBadge } from '../lib/avatar.js';
import { t } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { openCommandPalette } from './CommandPalette.js';

export interface RightPanelProps {
  onSearch?: (query: string) => void;
  onFollowUser?: (userId: string) => void;
}

export interface UserSuggestion {
  id: string;
  username: string;
  display_name: string;
  avatar_key?: string;
  badge_type?: string | null;
}

export class RightPanel {
  private element: HTMLElement;
  private trendingTags: Array<{ tag: string; count: number; percentage: number }> = [];
  private userSuggestions: UserSuggestion[] = [];

  constructor(props: RightPanelProps = {}) {
    this.element = this.createElement();
    this.setupEventListeners();
    this.loadTrendingTags();
    this.loadUserSuggestions();
  }

  private createElement(): HTMLElement {
    const container = document.createElement('aside');
    container.className = 'right-panel';

    // Search box
    const searchSection = this.createSearchSection();
    container.appendChild(searchSection);

    // Trending hashtags
    const trendingSection = this.createTrendingSection();
    container.appendChild(trendingSection);

    // Who to follow
    const followSection = this.createFollowSection();
    container.appendChild(followSection);

    // Admax ad section
    //const adSection = this.createAdSection()
    //container.appendChild(adSection)

    return container;
  }

  private createSearchSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'search-section';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'palette-trigger';
    trigger.setAttribute('aria-label', t('right_panel.search_placeholder'));

    const iconWrap = document.createElement('span');
    iconWrap.className = 'search-icon';
    iconWrap.appendChild(icon('search'));

    const label = document.createElement('span');
    label.className = 'palette-trigger-label';
    label.textContent = t('right_panel.search_placeholder');

    const kbd = document.createElement('kbd');
    kbd.className = 'cmd-kbd palette-trigger-kbd';
    kbd.textContent = '⌘K';

    trigger.appendChild(iconWrap);
    trigger.appendChild(label);
    trigger.appendChild(kbd);
    trigger.addEventListener('click', () => openCommandPalette());
    section.appendChild(trigger);

    return section;
  }

  private createTrendingSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'trending-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = t('right_panel.trending');

    const list = document.createElement('div');
    list.className = 'trending-list';

    const loading = document.createElement('div');
    loading.className = 'trending-loading';
    loading.textContent = t('common.loading');
    list.appendChild(loading);

    section.appendChild(title);
    section.appendChild(list);

    return section;
  }

  private createFollowSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'follow-section';
    section.style.display = 'none'; // Hidden by default, shown when we have suggestions

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = t('right_panel.who_to_follow');

    const list = document.createElement('div');
    list.className = 'follow-list';

    const loading = document.createElement('div');
    loading.className = 'follow-loading';
    loading.textContent = t('common.loading');
    list.appendChild(loading);

    section.appendChild(title);
    section.appendChild(list);

    return section;
  }

  private setupEventListeners(): void {
    // Search now opens the command palette (wired in createSearchSection).
    // Follow buttons will be set up dynamically when user suggestions are loaded
  }

  private async loadTrendingTags(): Promise<void> {
    try {
      const response = await fetch('/api/tags/trending');
      if (!response.ok) {
        throw new Error('Failed to load trending tags');
      }

      const data = (await response.json()) as { tags: Array<{ tag: string; count: number; percentage: number }> };
      this.trendingTags = data.tags || [];
      this.renderTrendingTags();
    } catch (error) {
      console.error('Failed to load trending tags:', error);
    }
  }

  private renderTrendingTags(): void {
    const trendingList = this.element.querySelector('.trending-list');
    if (!trendingList) return;

    trendingList.innerHTML = '';

    if (this.trendingTags.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'trending-empty';
      emptyState.textContent = t('right_panel.no_trending');
      trendingList.appendChild(emptyState);
      return;
    }

    const maxCount = Math.max(1, ...this.trendingTags.map((entry) => entry.count || 0));

    this.trendingTags.forEach(({ tag, count, percentage }, index) => {
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
      hashtag.textContent = t('right_panel.trending_tag', { tag });

      const meta = document.createElement('div');
      meta.className = 'trending-meta';
      const parts = [t('right_panel.trending_percent', { percentage })];
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

      const openTag = () => {
        window.location.href = `/explore?tag=${encodeURIComponent(tag)}`;
      };
      item.addEventListener('click', openTag);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openTag();
        }
      });

      trendingList.appendChild(item);
    });
  }

  private async loadUserSuggestions(): Promise<void> {
    try {
      const response = await fetch('/api/users/suggestions');
      if (!response.ok) {
        throw new Error('Failed to load user suggestions');
      }

      const data = (await response.json()) as { users: UserSuggestion[] };
      this.userSuggestions = data.users || [];
      this.renderUserSuggestions();
    } catch (error) {
      console.error('Failed to load user suggestions:', error);
    }
  }

  private renderUserSuggestions(): void {
    const followSection = this.element.querySelector('.follow-section') as HTMLElement;
    const followList = this.element.querySelector('.follow-list');

    if (!followSection || !followList) return;

    // Hide section for guests or when no suggestions
    if (this.userSuggestions.length === 0) {
      followSection.style.display = 'none';
      return;
    }

    // Show section and render suggestions
    followSection.style.display = 'block';
    followList.innerHTML = '';

    this.userSuggestions.forEach((user, index) => {
      const item = document.createElement('div');
      item.className = 'follow-item';
      item.dataset.userId = user.id;
      item.style.setProperty('--i', String(Math.min(index, 7)));

      // Create avatar element
      const avatar = document.createElement('div');
      avatar.className = 'follow-avatar';
      if (user.avatar_key) {
        avatar.style.backgroundImage = `url('/api/images/${user.avatar_key}')`;
      } else {
        avatar.textContent = user.display_name.charAt(0).toUpperCase();
      }
      attachPlusBadge(avatar, user.badge_type);

      // Create info container
      const info = document.createElement('div');
      info.className = 'follow-info';

      const name = document.createElement('div');
      name.className = 'follow-name';
      name.textContent = user.display_name;
      name.addEventListener('click', () => {
        window.location.href = `/profile/${user.username}`;
      });

      const handle = document.createElement('div');
      handle.className = 'follow-handle';
      handle.textContent = `@${user.username}`;

      info.appendChild(name);
      info.appendChild(handle);

      // Create follow button
      const button = document.createElement('button');
      button.className = 'follow-button';
      button.textContent = t('right_panel.follow');

      button.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.followUser(user.id, item);
      });

      // Assemble the item
      item.appendChild(avatar);
      item.appendChild(info);
      item.appendChild(button);

      followList.appendChild(item);
    });
  }

  private async followUser(userId: string, itemElement: HTMLElement): Promise<void> {
    try {
      const response = await fetch(`/api/follows/${userId}`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to follow user');
      }

      // Remove user from suggestions and fade out the item
      this.userSuggestions = this.userSuggestions.filter((user) => user.id !== userId);

      // Morph the button into a success state, then slide the row away
      const button = itemElement.querySelector('.follow-button');
      if (button) {
        button.classList.add('is-done');
        button.textContent = t('right_panel.following');
      }
      // Wait a beat so the success state reads, then animate out
      setTimeout(() => itemElement.classList.add('is-leaving'), 450);

      setTimeout(() => {
        itemElement.remove();

        // If no more suggestions, hide the entire section
        if (this.userSuggestions.length === 0) {
          const followSection = this.element.querySelector('.follow-section') as HTMLElement;
          if (followSection) {
            followSection.style.display = 'none';
          }
        }
      }, 750);
    } catch (error) {
      console.error('Failed to follow user:', error);
    }
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public destroy(): void {
    this.element.remove();
  }
}

// Factory function for easier usage
export function createRightPanel(props: RightPanelProps = {}): RightPanel {
  return new RightPanel(props);
}
