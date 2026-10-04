import {
  createZipLoadingIndicator,
  createZipSandboxIframe,
  fadeOutLoading,
  showLoadingTimeoutMessage,
  waitForZipIframeLoad,
} from './zip-ui-utils.js';

export interface WvfsZipExecutorHandle {
  destroy: () => void;
  postId: string;
}

const PREFIX = 'wvfs';

let activeHandle: WvfsZipExecutorHandle | null = null;

export async function executeWvfsZip(
  postId: string,
  containerEl: HTMLElement,
  workerUrl?: string,
  hideFullscreen: boolean = false,
  showLoading: boolean = true,
  versionId?: string,
): Promise<WvfsZipExecutorHandle> {
  if (activeHandle) {
    activeHandle.destroy();
    activeHandle = null;
  }

  try {
    containerEl.innerHTML = '';
    containerEl.style.position = 'relative';

    let loadingEl: HTMLElement | null = null;
    if (showLoading) {
      loadingEl = createZipLoadingIndicator(PREFIX);
      containerEl.appendChild(loadingEl);
    }

    const sandboxOrigin = workerUrl || import.meta.env.VITE_SANDBOX_ORIGIN || 'https://sandbox.flaxia.app';
    const zipUrl = `${sandboxOrigin}/api/wvfs-zip/${postId}${versionId ? `?v=${versionId}` : ''}`;
    const preWarmUrl = `${zipUrl}/index.html`;
    fetch(preWarmUrl, { method: 'GET', mode: 'cors' }).catch(() => {});

    // Never grant allow-same-origin here: uploaded ZIP content must stay
    // sandboxed even though it is served from the separate sandbox origin.
    // These flags match the Service Worker execution path.
    const { iframe, cleanup } = createZipSandboxIframe(containerEl, zipUrl, {
      sandbox: 'allow-scripts allow-pointer-lock allow-fullscreen',
      hideFullscreen,
      prefix: PREFIX,
    });

    const loaded = await waitForZipIframeLoad(iframe, loadingEl);

    if (loaded) {
      iframe.style.opacity = '1';
      fadeOutLoading(loadingEl);
    } else {
      showLoadingTimeoutMessage(loadingEl);
      iframe.style.opacity = '1';
    }

    const handle: WvfsZipExecutorHandle = {
      postId,
      destroy: () => {
        clearTimeout((iframe as HTMLIFrameElement & { _zipLoadTimeout?: number })._zipLoadTimeout);
        cleanup();
        const fullscreenBtn = containerEl.querySelector(`.${PREFIX}-fullscreen-btn`);
        if (fullscreenBtn) {
          fullscreenBtn.parentNode?.removeChild(fullscreenBtn);
        }
        if (activeHandle?.postId === postId) {
          activeHandle = null;
        }
      },
    };

    activeHandle = handle;
    return handle;
  } catch (error) {
    if (activeHandle) {
      activeHandle.destroy();
      activeHandle = null;
    }
    throw error;
  }
}
