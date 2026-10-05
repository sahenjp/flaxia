export function createSkeletonCard(): HTMLElement {
  const container = document.createElement('article');
  container.className = 'skeleton-card';
  container.setAttribute('aria-hidden', 'true');

  // Header skeleton
  const header = document.createElement('div');
  header.className = 'skeleton-header';

  // Avatar skeleton
  const avatar = document.createElement('div');
  avatar.className = 'skeleton-avatar skeleton-shimmer';

  // User info skeleton
  const userInfo = document.createElement('div');
  userInfo.className = 'skeleton-user-info';

  const username = document.createElement('div');
  username.className = 'skeleton-line skeleton-shimmer skeleton-line--name';

  const timestamp = document.createElement('div');
  timestamp.className = 'skeleton-line skeleton-shimmer skeleton-line--time';

  userInfo.appendChild(username);
  userInfo.appendChild(timestamp);

  // Text content skeleton
  const textSkeleton = document.createElement('div');
  textSkeleton.className = 'skeleton-text';

  // Create multiple text lines
  for (let i = 0; i < 3; i++) {
    const line = document.createElement('div');
    line.className = `skeleton-line skeleton-shimmer${i === 2 ? ' skeleton-line--short' : ''}`;
    textSkeleton.appendChild(line);
  }

  // Media skeleton (16:9 aspect ratio)
  const mediaSkeleton = document.createElement('div');
  mediaSkeleton.className = 'skeleton-media skeleton-shimmer';

  // Actions skeleton
  const actions = document.createElement('div');
  actions.className = 'skeleton-actions';

  const createActionButton = () => {
    const button = document.createElement('div');
    button.className = 'skeleton-action skeleton-shimmer';
    return button;
  };

  actions.appendChild(createActionButton());
  actions.appendChild(createActionButton());
  actions.appendChild(createActionButton());

  // Assemble skeleton
  header.appendChild(avatar);
  header.appendChild(userInfo);

  container.appendChild(header);
  container.appendChild(textSkeleton);
  container.appendChild(mediaSkeleton);
  container.appendChild(actions);

  return container;
}

export function createSkeletonPost(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'skeleton-post';
  container.setAttribute('aria-hidden', 'true');

  // Add multiple skeleton cards
  for (let i = 0; i < 3; i++) {
    container.appendChild(createSkeletonCard());
  }

  return container;
}
