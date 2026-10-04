import { clearMeCache } from '../lib/auth-cache';
import { createSrpProof, storeSrpSalt } from '../lib/auth-srp.js';
import { attachPlusBadge } from '../lib/avatar.js';
import { createConfirmDialog } from '../lib/confirm-dialog.js';
import {
  CROWD_CONSENT_CHANGE_EVENT,
  canRunFlaxiaNode,
  denyCrowdConsent,
  getCrowdConsentState,
  getCrowdNodeController,
  grantCrowdConsent,
  initCrowdNode,
  resolveCrowdConsentState,
  startCrowdNode,
  stopCrowdNode,
} from '../lib/crowd-node.js';
import { getLocale, setLocale, t } from '../lib/i18n.js';
import { passwordLengthError } from '../lib/password-policy.js';
import { getReplyStyle, getShowNsfw, ReplyStyle, setReplyStyle, setShowNsfw } from '../lib/settings.js';
import { computeVerifier, DEFAULT_SRP_KDF, generateSalt } from '../lib/srp.js';
import { getTheme, setTheme, Theme } from '../lib/theme.js';
import { prepareVaultRewrap } from '../lib/vault/client.js';
import { createAddStampModal } from './AddStampModal.js';
import { createVaultSection } from './VaultSection.js';

function b64(b: Uint8Array): string {
  let binary = '';
  for (const x of b) binary += String.fromCharCode(x);
  return btoa(binary);
}

interface SettingsPageProps {
  currentUser?: {
    id: string;
    username: string;
    display_name?: string;
    avatar_key?: string;
    badge_type?: string | null;
    language?: string;
    email?: string;
  };
}

export function createSettingsPage({ currentUser }: SettingsPageProps) {
  const container = document.createElement('div');
  container.className = 'settings-page';

  const topBar = document.createElement('div');
  topBar.className = 'settings-topbar';

  const backBtn = document.createElement('button');
  backBtn.textContent = '←';
  backBtn.className = 'settings-back-btn';
  backBtn.setAttribute('aria-label', t('settings.back') || 'Back');
  backBtn.addEventListener('click', () => window.history.back());

  const title = document.createElement('h1');
  title.textContent = t('settings.title');
  title.className = 'settings-title';

  topBar.appendChild(backBtn);
  topBar.appendChild(title);
  container.appendChild(topBar);

  // Account Section
  if (currentUser) {
    const accountSection = document.createElement('div');
    accountSection.className = 'settings-section';
    accountSection;

    const accountTitle = document.createElement('h2');
    accountTitle.textContent = t('settings.account');
    accountTitle.className = 'settings-section-title';

    const userChip = document.createElement('div');
    userChip.className = 'settings-user-chip';

    const avatarUrl = currentUser.avatar_key ? `/api/images/${currentUser.avatar_key}` : '/api/images/default-avatar';
    const displayName = currentUser.display_name || currentUser.username;

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'settings-avatar';
    const avatarEl = document.createElement('img');
    avatarEl.src = avatarUrl;
    avatarEl.alt = '';
    avatarEl.onerror = () => {
      avatarEl.src = '/api/images/default-avatar';
    };
    avatarWrap.appendChild(avatarEl);
    attachPlusBadge(avatarWrap, currentUser.badge_type);
    userChip.appendChild(avatarWrap);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'settings-user-info';
    userChip.appendChild(infoDiv);

    const displayNameEl = document.createElement('div');
    displayNameEl.className = 'settings-user-name';
    displayNameEl.textContent = displayName;
    infoDiv.appendChild(displayNameEl);

    const usernameEl = document.createElement('div');
    usernameEl.className = 'settings-user-handle';
    usernameEl.textContent = `@${currentUser.username}`;
    infoDiv.appendChild(usernameEl);

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-btn-row';

    const logoutButton = document.createElement('button');
    logoutButton.textContent = t('auth.sign_out');
    logoutButton.className = 'btn-secondary';
    btnRow.appendChild(logoutButton);

    logoutButton.addEventListener('click', async () => {
      const confirmed = await createConfirmDialog(t('auth.logout_confirm', { username: currentUser.username }));
      if (!confirmed) return;
      try {
        const response = await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });

        if (response.ok) {
          clearMeCache();
          window.location.href = '/';
        } else {
          alert(t('auth.logout_failed'));
        }
      } catch (error) {
        console.error('Logout error:', error);
        alert(t('auth.logout_error'));
      }
    });

    const deleteButton = document.createElement('button');
    deleteButton.textContent = t('settings.delete_account');
    deleteButton.className = 'profile-button profile-button--danger-outline';
    btnRow.appendChild(deleteButton);

    deleteButton.addEventListener('click', async () => {
      const confirmed = await createConfirmDialog(
        t('settings.delete_account_confirm', { username: currentUser.username }),
      );
      if (!confirmed) return;
      try {
        const response = await fetch('/api/users/me', {
          method: 'DELETE',
          credentials: 'include',
        });

        if (response.ok) {
          clearMeCache();
          window.location.href = '/';
        } else {
          alert(t('settings.delete_account_failed'));
        }
      } catch (error) {
        console.error('Delete account error:', error);
        alert(t('settings.delete_account_error'));
      }
    });

    accountSection.appendChild(accountTitle);
    accountSection.appendChild(userChip);
    accountSection.appendChild(btnRow);
    container.appendChild(accountSection);
  }

  // Display Section
  const displaySection = document.createElement('div');
  displaySection.className = 'settings-section';

  const displayTitle = document.createElement('h2');
  displayTitle.textContent = t('settings.display');
  displayTitle.className = 'settings-section-title';

  const currentStyle = getReplyStyle();

  const radioGroup = document.createElement('div');
  radioGroup.className = 'settings-option-group';

  const styles: { value: ReplyStyle; labelKey: string; descKey: string }[] = [
    { value: 'twitter', labelKey: 'settings.reply_style_twitter', descKey: 'settings.reply_style_twitter_desc' },
    { value: '2ch', labelKey: 'settings.reply_style_2ch', descKey: 'settings.reply_style_2ch_desc' },
  ];

  styles.forEach((s) => {
    const label = document.createElement('label');
    label.className = `settings-option${currentStyle === s.value ? ' is-selected' : ''}`;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'reply-style';
    radio.value = s.value;
    radio.checked = currentStyle === s.value;

    const textDiv = document.createElement('div');
    textDiv.className = 'settings-option-text';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'settings-option-name';
    nameSpan.textContent = t(s.labelKey);

    const descSpan = document.createElement('span');
    descSpan.className = 'settings-option-desc';
    descSpan.textContent = t(s.descKey);

    textDiv.appendChild(nameSpan);
    textDiv.appendChild(descSpan);
    label.appendChild(radio);
    label.appendChild(textDiv);
    radioGroup.appendChild(label);

    radio.addEventListener('change', () => {
      setReplyStyle(s.value);
      radioGroup.querySelectorAll('label').forEach((l) => {
        l.classList.remove('is-selected');
      });
      label.classList.add('is-selected');
      displayMessage.textContent = t('settings.display_saved');
    });
  });

  // NSFW toggle
  const nsfwLabel = document.createElement('label');
  nsfwLabel.className = `settings-option${getShowNsfw() ? ' is-selected' : ''}`;

  const nsfwCheckbox = document.createElement('input');
  nsfwCheckbox.type = 'checkbox';
  nsfwCheckbox.checked = getShowNsfw();

  const nsfwTextDiv = document.createElement('div');
  nsfwTextDiv.className = 'settings-option-text';

  const nsfwNameSpan = document.createElement('span');
  nsfwNameSpan.className = 'settings-option-name';
  nsfwNameSpan.textContent = t('settings.nsfw');

  const nsfwDescSpan = document.createElement('span');
  nsfwDescSpan.className = 'settings-option-desc';
  nsfwDescSpan.textContent = t('settings.nsfw_desc');

  nsfwTextDiv.appendChild(nsfwNameSpan);
  nsfwTextDiv.appendChild(nsfwDescSpan);
  nsfwLabel.appendChild(nsfwCheckbox);
  nsfwLabel.appendChild(nsfwTextDiv);

  nsfwCheckbox.addEventListener('change', () => {
    setShowNsfw(nsfwCheckbox.checked);
    nsfwLabel.classList.toggle('is-selected', nsfwCheckbox.checked);
    displayMessage.textContent = t('settings.display_saved');
  });

  // Theme selector
  const themeTitle = document.createElement('div');
  themeTitle.className = 'settings-field-label';
  themeTitle.textContent = t('settings.theme');

  const currentTheme = getTheme();
  const themeRadioGroup = document.createElement('div');
  themeRadioGroup.className = 'settings-option-group';

  const themes: { value: Theme; labelKey: string; descKey: string }[] = [
    { value: 'light', labelKey: 'settings.theme_light', descKey: 'settings.theme_light_desc' },
    { value: 'dark', labelKey: 'settings.theme_dark', descKey: 'settings.theme_dark_desc' },
    { value: 'system', labelKey: 'settings.theme_system', descKey: 'settings.theme_system_desc' },
  ];

  themes.forEach((st) => {
    const label = document.createElement('label');
    label.className = `settings-option${currentTheme === st.value ? ' is-selected' : ''}`;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'theme';
    radio.value = st.value;
    radio.checked = currentTheme === st.value;

    const textDiv = document.createElement('div');
    textDiv.className = 'settings-option-text';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'settings-option-name';
    nameSpan.textContent = t(st.labelKey);

    const descSpan = document.createElement('span');
    descSpan.className = 'settings-option-desc';
    descSpan.textContent = t(st.descKey);

    textDiv.appendChild(nameSpan);
    textDiv.appendChild(descSpan);
    label.appendChild(radio);
    label.appendChild(textDiv);
    themeRadioGroup.appendChild(label);

    radio.addEventListener('change', () => {
      setTheme(st.value);
      themeRadioGroup.querySelectorAll('label').forEach((l) => {
        l.classList.remove('is-selected');
      });
      label.classList.add('is-selected');
      displayMessage.textContent = t('settings.display_saved');
    });
  });

  const displayMessage = document.createElement('div');
  displayMessage.className = 'settings-saved-note';

  displaySection.appendChild(displayTitle);
  displaySection.appendChild(radioGroup);
  displaySection.appendChild(nsfwLabel);
  displaySection.appendChild(themeTitle);
  displaySection.appendChild(themeRadioGroup);
  displaySection.appendChild(displayMessage);

  container.appendChild(displaySection);

  // Crowd Section (opt in/out of donating browser compute)
  const crowdSection = document.createElement('div');
  crowdSection.className = 'settings-section';

  const crowdTitle = document.createElement('h2');
  crowdTitle.textContent = t('settings.crowd');
  crowdTitle.className = 'settings-section-title';

  const nodeAvailable = canRunFlaxiaNode();

  const crowdLabel = document.createElement('label');
  crowdLabel.className = `settings-option${getCrowdConsentState() === 'granted' ? ' is-selected' : ''}`;
  if (!nodeAvailable) {
    crowdLabel.style.cursor = 'not-allowed';
    crowdLabel.style.opacity = '0.6';
  }

  const crowdCheckbox = document.createElement('input');
  crowdCheckbox.type = 'checkbox';
  crowdCheckbox.checked = getCrowdConsentState() === 'granted';
  crowdCheckbox.disabled = !nodeAvailable;

  const crowdTextDiv = document.createElement('div');
  crowdTextDiv.className = 'settings-option-text';

  const crowdNameSpan = document.createElement('span');
  crowdNameSpan.className = 'settings-option-name';
  crowdNameSpan.textContent = t('settings.crowd');

  const crowdDescSpan = document.createElement('span');
  crowdDescSpan.className = 'settings-option-desc';
  crowdDescSpan.textContent = t('settings.crowd_desc');

  crowdTextDiv.appendChild(crowdNameSpan);
  crowdTextDiv.appendChild(crowdDescSpan);
  crowdLabel.appendChild(crowdCheckbox);
  crowdLabel.appendChild(crowdTextDiv);

  const crowdStatus = document.createElement('div');
  crowdStatus.className = 'settings-hint';

  const crowdMessage = document.createElement('div');
  crowdMessage.className = 'settings-saved-note';

  const updateCrowdStatus = () => {
    if (!nodeAvailable) {
      crowdStatus.textContent = t('settings.crowd_unavailable');
      return;
    }
    const state = getCrowdConsentState();
    crowdStatus.textContent =
      state === 'granted'
        ? t('settings.crowd_running')
        : state === 'denied'
          ? t('settings.crowd_denied')
          : t('settings.crowd_unset');
    crowdStatus.style.color = state === 'granted' ? 'var(--success, #10b981)' : 'var(--text-muted)';
  };
  updateCrowdStatus();

  crowdCheckbox.addEventListener('change', async () => {
    if (!nodeAvailable) return;
    // The node controller is created during deferred app init; make sure it
    // exists before mutating state so a fast navigation never loses the toggle.
    if (!getCrowdNodeController()) {
      try {
        await initCrowdNode();
      } catch {
        // fall through to the availability check below
      }
    }
    if (!getCrowdNodeController()) {
      crowdMessage.textContent = t('settings.crowd_unavailable');
      crowdMessage.style.color = 'var(--danger, #ef4444)';
      crowdCheckbox.checked = false;
      return;
    }
    if (crowdCheckbox.checked) {
      grantCrowdConsent();
      startCrowdNode();
    } else {
      denyCrowdConsent();
      stopCrowdNode();
    }
    crowdLabel.classList.toggle('is-selected', crowdCheckbox.checked);
    updateCrowdStatus();
    crowdMessage.textContent = t('settings.crowd_saved');
    crowdMessage.style.color = 'var(--success, #10b981)';
  });

  // Stay in sync if consent is changed elsewhere (e.g. the consent modal).
  const onCrowdConsentChange = () => {
    crowdCheckbox.checked = getCrowdConsentState() === 'granted';
    crowdLabel.classList.toggle('is-selected', crowdCheckbox.checked);
    updateCrowdStatus();
  };
  window.addEventListener(CROWD_CONSENT_CHANGE_EVENT, onCrowdConsentChange);

  // The node bundle is loaded during deferred app init, which may run after this
  // screen renders (e.g. a direct /settings reload). Load its persisted consent
  // state through the public API so the toggle is correct on first paint.
  void resolveCrowdConsentState().then(onCrowdConsentChange);

  crowdSection.appendChild(crowdTitle);
  crowdSection.appendChild(crowdLabel);
  crowdSection.appendChild(crowdStatus);
  crowdSection.appendChild(crowdMessage);

  container.appendChild(crowdSection);

  // Language Section
  const languageSection = document.createElement('div');
  languageSection.className = 'settings-section';

  const languageTitle = document.createElement('h2');
  languageTitle.textContent = t('settings.language');
  languageTitle.className = 'settings-section-title';

  const languageSelect = document.createElement('select');
  languageSelect.className = 'settings-select';

  fetch('/locales/index.json')
    .then((r) => r.json())
    .then((locales) => {
      languageSelect.innerHTML = '';
      (locales as { code: string; nativeName: string }[]).forEach((l) => {
        const opt = document.createElement('option');
        opt.value = l.code;
        opt.textContent = l.nativeName;
        languageSelect.appendChild(opt);
      });
      if (currentUser?.language) {
        languageSelect.value = currentUser.language;
      } else {
        languageSelect.value = getLocale();
      }
    })
    .catch(() => {
      ['en', 'ja'].forEach((code) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = code;
        languageSelect.appendChild(opt);
      });
    });

  // Set current language
  if (currentUser?.language) {
    languageSelect.value = currentUser.language;
  }

  const languageSaveButton = document.createElement('button');
  languageSaveButton.textContent = t('common.save');
  languageSaveButton.className = 'btn-primary';

  const languageMessage = document.createElement('div');
  languageMessage.className = 'settings-saved-note';

  const languageBtnRow = document.createElement('div');
  languageBtnRow.className = 'settings-btn-row';
  languageBtnRow.appendChild(languageSaveButton);

  languageSection.appendChild(languageTitle);
  languageSection.appendChild(languageSelect);
  languageSection.appendChild(languageBtnRow);
  languageSection.appendChild(languageMessage);

  // Email Section
  const emailSection = document.createElement('div');
  emailSection.className = 'settings-section';

  const emailTitle = document.createElement('h2');
  emailTitle.textContent = t('settings.change_email');
  emailTitle.className = 'settings-section-title';

  const currentPasswordLabel = document.createElement('label');
  currentPasswordLabel.textContent = t('settings.email_current_password');
  currentPasswordLabel.className = 'settings-field-label';

  const currentPasswordInput = document.createElement('input');
  currentPasswordInput.type = 'password';
  currentPasswordInput.placeholder = t('settings.email_current_password_placeholder');
  currentPasswordInput.className = 'settings-input';

  const newEmailLabel = document.createElement('label');
  newEmailLabel.textContent = t('settings.email_new_email');
  newEmailLabel.className = 'settings-field-label';

  const newEmailInput = document.createElement('input');
  newEmailInput.type = 'email';
  newEmailInput.placeholder = t('settings.email_new_email_placeholder');
  newEmailInput.className = 'settings-input';

  const emailSaveButton = document.createElement('button');
  emailSaveButton.textContent = t('common.save');
  emailSaveButton.className = 'btn-primary';

  const emailMessage = document.createElement('div');
  emailMessage.className = 'settings-saved-note';

  emailSection.appendChild(emailTitle);
  emailSection.appendChild(currentPasswordLabel);
  emailSection.appendChild(currentPasswordInput);
  emailSection.appendChild(newEmailLabel);
  emailSection.appendChild(newEmailInput);
  emailSection.appendChild(emailSaveButton);
  emailSection.appendChild(emailMessage);

  // Password Section
  const passwordSection = document.createElement('div');
  passwordSection.className = 'settings-section';

  const passwordTitle = document.createElement('h2');
  passwordTitle.textContent = t('settings.change_password');
  passwordTitle.className = 'settings-section-title';

  const currentPasswordLabel2 = document.createElement('label');
  currentPasswordLabel2.textContent = t('settings.password_current');
  currentPasswordLabel2.className = 'settings-field-label';

  const currentPasswordInput2 = document.createElement('input');
  currentPasswordInput2.type = 'password';
  currentPasswordInput2.placeholder = t('settings.password_current_placeholder');
  currentPasswordInput2.className = 'settings-input';

  const newPasswordLabel = document.createElement('label');
  newPasswordLabel.textContent = t('settings.password_new');
  newPasswordLabel.className = 'settings-field-label';

  const newPasswordInput = document.createElement('input');
  newPasswordInput.type = 'password';
  newPasswordInput.placeholder = t('settings.password_new_placeholder');
  newPasswordInput.className = 'settings-input';

  const confirmPasswordLabel = document.createElement('label');
  confirmPasswordLabel.textContent = t('settings.password_confirm');
  confirmPasswordLabel.className = 'settings-field-label';

  const confirmPasswordInput = document.createElement('input');
  confirmPasswordInput.type = 'password';
  confirmPasswordInput.placeholder = t('settings.password_confirm_placeholder');
  confirmPasswordInput.className = 'settings-input';

  const passwordSaveButton = document.createElement('button');
  passwordSaveButton.textContent = t('common.save');
  passwordSaveButton.className = 'btn-primary';

  const passwordMessage = document.createElement('div');
  passwordMessage.className = 'settings-saved-note';

  passwordSection.appendChild(passwordTitle);
  passwordSection.appendChild(currentPasswordLabel2);
  passwordSection.appendChild(currentPasswordInput2);
  passwordSection.appendChild(newPasswordLabel);
  passwordSection.appendChild(newPasswordInput);
  passwordSection.appendChild(confirmPasswordLabel);
  passwordSection.appendChild(confirmPasswordInput);
  passwordSection.appendChild(passwordSaveButton);
  passwordSection.appendChild(passwordMessage);

  // Event handlers
  languageSaveButton.addEventListener('click', async () => {
    const language = languageSelect.value;
    languageMessage.textContent = '';
    languageSaveButton.disabled = true;
    languageSaveButton.style.opacity = '0.6';

    try {
      const response = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ language }),
      });

      if (response.ok) {
        languageMessage.textContent = t('settings.language_saved');
        languageMessage.style.color = 'var(--success, #10b981)';
        await setLocale(language);
        location.reload();
      } else {
        const errorData = (await response.json()) as { error?: string };
        languageMessage.textContent = errorData.error || t('settings.language_save_failed');
        languageMessage.style.color = 'var(--danger)';
      }
    } catch (_error: unknown) {
      languageMessage.textContent = t('settings.language_network_error');
      languageMessage.style.color = 'var(--danger)';
    } finally {
      languageSaveButton.disabled = false;
      languageSaveButton.style.opacity = '1';
    }
  });

  emailSaveButton.addEventListener('click', async () => {
    const currentPassword = currentPasswordInput.value.trim();
    const newEmail = newEmailInput.value.trim();

    if (!currentPassword || !newEmail) {
      emailMessage.textContent = t('settings.email_fill_all');
      emailMessage.style.color = 'var(--danger)';
      return;
    }

    emailMessage.textContent = '';
    emailSaveButton.disabled = true;
    emailSaveButton.style.opacity = '0.6';

    try {
      // Re-authenticate with an SRP proof: the server verifies knowledge of
      // the current password without ever receiving it.
      const proof = await createSrpProof(currentPassword);
      if (!proof) {
        emailMessage.textContent = t('settings.current_password_incorrect');
        emailMessage.style.color = 'var(--danger)';
        return;
      }

      const response = await fetch('/api/users/me/email', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ current_srp: proof, new_email: newEmail }),
      });

      if (response.ok) {
        emailMessage.textContent = t('settings.email_saved');
        emailMessage.style.color = 'var(--success, #10b981)';
        currentPasswordInput.value = '';
        newEmailInput.value = '';
      } else {
        const errorData = (await response.json()) as { error?: string };
        emailMessage.textContent = errorData.error || t('settings.email_save_failed');
        emailMessage.style.color = 'var(--danger)';
      }
    } catch (_error: unknown) {
      emailMessage.textContent = t('settings.email_network_error');
      emailMessage.style.color = 'var(--danger)';
    } finally {
      emailSaveButton.disabled = false;
      emailSaveButton.style.opacity = '1';
    }
  });

  passwordSaveButton.addEventListener('click', async () => {
    const currentPassword = currentPasswordInput2.value.trim();
    const newPassword = newPasswordInput.value.trim();
    const confirmPassword = confirmPasswordInput.value.trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      passwordMessage.textContent = t('settings.password_fill_all');
      passwordMessage.style.color = 'var(--danger)';
      return;
    }

    if (newPassword !== confirmPassword) {
      passwordMessage.textContent = t('settings.password_mismatch');
      passwordMessage.style.color = 'var(--danger)';
      return;
    }

    if (passwordLengthError(newPassword)) {
      passwordMessage.textContent = t('settings.password_length');
      passwordMessage.style.color = 'var(--danger)';
      return;
    }

    passwordMessage.textContent = '';
    passwordSaveButton.disabled = true;
    passwordSaveButton.style.opacity = '0.6';

    try {
      // Derive a fresh SRP verifier from the new password so the account
      // continues to authenticate via SRP after the change. Neither the
      // current nor the new password is sent to the server: the current one is
      // proven with an SRP handshake, the new one only as its verifier.
      const salt = generateSalt();
      const verifier = await computeVerifier(newPassword, salt, DEFAULT_SRP_KDF);

      const currentSrp = await createSrpProof(currentPassword);
      if (!currentSrp) {
        passwordMessage.textContent = t('settings.current_password_incorrect');
        passwordMessage.style.color = 'var(--danger)';
        return;
      }

      // Carry the vault across: VK is wrapped under a KEK derived from the OLD
      // password, so it must be re-wrapped inside this very request. Refusing
      // to proceed beats storing an envelope the new password cannot open.
      const vaultRewrap = await prepareVaultRewrap(currentPassword, newPassword);
      if (vaultRewrap.status === 'unlock_failed') {
        passwordMessage.textContent = t('settings.current_password_incorrect');
        passwordMessage.style.color = 'var(--danger)';
        return;
      }
      if (vaultRewrap.status === 'error') {
        passwordMessage.textContent = t('settings.password_save_failed');
        passwordMessage.style.color = 'var(--danger)';
        return;
      }

      const response = await fetch('/api/users/me/password', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          srp_salt: b64(salt),
          srp_verifier: b64(verifier),
          srp_group: '2048',
          srp_kdf: DEFAULT_SRP_KDF,
          current_srp: currentSrp,
          ...(vaultRewrap.status === 'ok' ? { vault_kek: vaultRewrap.fields } : {}),
        }),
      });

      if (response.ok) {
        storeSrpSalt(salt);
        passwordMessage.textContent = t('settings.password_saved');
        passwordMessage.style.color = 'var(--success, #10b981)';
        currentPasswordInput2.value = '';
        newPasswordInput.value = '';
        confirmPasswordInput.value = '';
      } else {
        const errorData = (await response.json()) as { error?: string };
        const message =
          errorData.error === 'vault_rewrap_required'
            ? t('settings.vault_rewrap_required')
            : errorData.error || t('settings.password_save_failed');
        passwordMessage.textContent = message;
        passwordMessage.style.color = 'var(--danger)';
      }
    } catch (_error: unknown) {
      passwordMessage.textContent = t('settings.password_network_error');
      passwordMessage.style.color = 'var(--danger)';
    } finally {
      passwordSaveButton.disabled = false;
      passwordSaveButton.style.opacity = '1';
    }
  });

  // Add hover effects
  const buttons = [languageSaveButton, emailSaveButton, passwordSaveButton];
  buttons.forEach((button: HTMLButtonElement) => {
    button.addEventListener('mouseenter', () => {
      if (!button.disabled) {
        button.style.opacity = '0.8';
      }
    });
    button.addEventListener('mouseleave', () => {
      if (!button.disabled) {
        button.style.opacity = '1';
      }
    });
  });

  container.appendChild(languageSection);
  container.appendChild(emailSection);
  container.appendChild(passwordSection);

  // ─── Personal Vault Section ──────────────────────────────────────────────
  // Own component: it has three states of its own (setup / locked / unlocked)
  // and timers to clean up, which would drown the settings page otherwise.
  const vaultSection = createVaultSection();
  container.appendChild(vaultSection.getElement());

  // Shared billing state: populated by `loadBilling`, read by the stamp counter.
  let currentPlan: {
    plan: string | null;
    status: string | null;
    expiresAt: string | null;
    cancelAtPeriodEnd: boolean;
  } = { plan: null, status: null, expiresAt: null, cancelAtPeriodEnd: false };
  let refreshStamps: () => void = () => {};

  // ─── Custom Emoji Section ────────────────────────────────────────────────
  if (currentUser) {
    const emojiSection = document.createElement('div');
    emojiSection.className = 'settings-section';

    const emojiTitle = document.createElement('h2');
    emojiTitle.textContent = t('settings.custom_emoji') || 'Custom Emoji';
    emojiTitle.className = 'settings-section-title';

    const emojiDesc = document.createElement('p');
    emojiDesc.textContent =
      t('settings.custom_emoji_desc') ||
      'Create custom emoji like :working_me: to use in reactions and messages. Only you can use your custom emoji, but others can see them.';
    emojiDesc.className = 'settings-hint settings-desc-block';

    const emojiCountRow = document.createElement('div');
    emojiCountRow.className = 'settings-count-row';
    const emojiCountLabel = document.createElement('span');
    emojiCountLabel.className = 'settings-count-label';
    const emojiCountValue = document.createElement('span');
    emojiCountValue.className = 'settings-count-value';
    emojiCountLabel.textContent = t('settings.custom_emoji_count') || 'Emoji used:';
    emojiCountValue.textContent = '...';
    emojiCountRow.appendChild(emojiCountLabel);
    emojiCountRow.appendChild(emojiCountValue);

    // Stamps list
    const stampsGrid = document.createElement('div');
    stampsGrid.className = 'settings-stamps-grid';

    function loadStamps() {
      fetch('/api/stamps', { credentials: 'include' })
        .then((r) => r.json() as Promise<{ stamps: Array<{ id: string; name: string; url: string }> }>)
        .then((data) => {
          stampsGrid.innerHTML = '';
          const unlimited = !!currentPlan.plan && ['active', 'trialing'].includes(currentPlan.status || '');
          emojiCountValue.textContent = unlimited ? `${data.stamps.length} / ∞` : `${data.stamps.length} / 5`;
          for (const stamp of data.stamps) {
            const card = document.createElement('div');
            card.className = 'settings-stamp-card';
            const img = document.createElement('img');
            img.src = stamp.url;
            img.alt = stamp.name;
            img.className = 'settings-stamp-img';
            const label = document.createElement('div');
            label.className = 'settings-stamp-name';
            label.textContent = stamp.name;
            label.title = stamp.name;
            const delBtn = document.createElement('button');
            delBtn.textContent = '✕';
            delBtn.className = 'settings-stamp-del';
            delBtn.setAttribute('aria-label', `Delete ${stamp.name}`);
            delBtn.addEventListener('click', async () => {
              if (!confirm(t('settings.custom_emoji_delete_confirm', { name: stamp.name }) || `Delete ${stamp.name}?`))
                return;
              const res = await fetch(`/api/stamps/${stamp.id}`, { method: 'DELETE', credentials: 'include' });
              if (res.ok) loadStamps();
            });
            card.appendChild(delBtn);
            card.appendChild(img);
            card.appendChild(label);
            stampsGrid.appendChild(card);
          }

          // Add "add" card
          const addCard = document.createElement('div');
          addCard.className = 'settings-stamp-add';
          const addIcon = document.createElement('div');
          addIcon.textContent = '+';
          addIcon.className = 'settings-stamp-add-icon';
          const addLabel = document.createElement('div');
          addLabel.className = 'settings-stamp-add-label';
          addLabel.textContent = t('settings.add_stamp_tap_to_add') || 'Tap to add';
          addCard.appendChild(addIcon);
          addCard.appendChild(addLabel);

          addCard.addEventListener('mouseenter', () => {
            addCard.style.borderColor = 'var(--accent)';
            addCard.style.background = 'var(--bg-hover, rgba(0,0,0,0.02))';
          });
          addCard.addEventListener('mouseleave', () => {
            addCard.style.borderColor = 'var(--border)';
            addCard.style.background = 'var(--bg-secondary)';
          });
          addCard.addEventListener('click', () => {
            createAddStampModal({ onUploaded: loadStamps });
          });

          stampsGrid.appendChild(addCard);
        })
        .catch(() => {
          stampsGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:1rem;">${t('settings.custom_emoji_load_failed') || 'Failed to load stamps'}</div>`;
        });
    }

    emojiSection.appendChild(emojiTitle);
    emojiSection.appendChild(emojiDesc);
    emojiSection.appendChild(emojiCountRow);
    emojiSection.appendChild(stampsGrid);
    container.appendChild(emojiSection);

    refreshStamps = loadStamps;
    loadStamps();
  }

  // Billing Section (Flaxia+ only)
  if (currentUser) {
    const billingSection = document.createElement('div');
    billingSection.className = 'settings-section';

    const billingTitle = document.createElement('h2');
    billingTitle.textContent = t('settings.billing') || 'Billing & Plans';
    billingTitle.className = 'settings-section-title';
    billingSection.appendChild(billingTitle);

    // Current plan display
    const planInfo = document.createElement('div');
    planInfo.className = 'settings-plan-info';
    const planLabel = document.createElement('div');
    planLabel.className = 'settings-field-label';
    planLabel.textContent = t('settings.current_plan') || 'Current Plan';
    const planName = document.createElement('div');
    planName.className = 'settings-plan-name';
    planName.textContent = t('settings.loading') || 'Loading...';
    const planMeta = document.createElement('div');
    planMeta.className = 'settings-hint';
    planInfo.appendChild(planLabel);
    planInfo.appendChild(planName);
    planInfo.appendChild(planMeta);
    billingSection.appendChild(planInfo);

    // Flaxia+ plan card
    const plusCard = document.createElement('div');
    plusCard.className = 'settings-plus-card';
    const plusName = document.createElement('div');
    plusName.className = 'settings-plus-name';
    plusName.textContent = 'Flaxia+';
    const plusPrice = document.createElement('div');
    plusPrice.className = 'settings-plus-price';
    const plusPriceNum = document.createElement('span');
    plusPriceNum.className = 'settings-plus-price-num';
    plusPriceNum.textContent = '¥300';
    const plusPricePeriod = document.createElement('span');
    plusPricePeriod.className = 'settings-plus-price-period';
    plusPricePeriod.textContent = '/mo';
    plusPrice.appendChild(plusPriceNum);
    plusPrice.appendChild(plusPricePeriod);

    const plusFeatures = document.createElement('ul');
    plusFeatures.className = 'settings-plus-features';
    const plusFeatureLabels = [
      t('settings.plan_plus_f1') || 'Unlimited custom stamps',
      t('settings.plan_plus_f2') || 'GIF & MP4 stamps/icons/intro',
      t('settings.plan_plus_f3') || 'Flaxia+ avatar checkmark badge',
    ];
    plusFeatureLabels.forEach((feature) => {
      const li = document.createElement('li');
      li.textContent = `✓ ${feature}`;
      plusFeatures.appendChild(li);
    });

    const actionBtn = document.createElement('button');
    actionBtn.className = 'settings-plus-btn';

    plusCard.appendChild(plusName);
    plusCard.appendChild(plusPrice);
    plusCard.appendChild(plusFeatures);
    plusCard.appendChild(actionBtn);
    billingSection.appendChild(plusCard);

    // Billing history
    const historySection = document.createElement('div');
    const historyTitle = document.createElement('div');
    historyTitle.className = 'settings-field-label';
    historyTitle.textContent = t('settings.billing_history') || 'Billing History';
    const historyList = document.createElement('div');
    historyList.className = 'settings-history-list';
    historyList.textContent = t('settings.loading') || 'Loading...';
    historySection.appendChild(historyTitle);
    historySection.appendChild(historyList);
    billingSection.appendChild(historySection);

    container.appendChild(billingSection);

    const planNames: Record<string, string> = {
      flaxia_plus: 'Flaxia+ (¥300/mo)',
      flaxia_plus_plus: 'Flaxia++ (¥500/mo)',
      flaxia_sharp: 'Flaxia# (¥1000/mo)',
    };

    const formatDate = (iso: string | null): string => {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleDateString(getLocale());
      } catch {
        return iso;
      }
    };

    const statusLabel = (status: string | null): string => {
      switch (status) {
        case 'active':
          return t('settings.status_active') || 'Active';
        case 'trialing':
          return t('settings.status_trialing') || 'Trial';
        case 'past_due':
          return t('settings.status_past_due') || 'Past due';
        case 'canceled':
          return t('settings.status_canceled') || 'Canceled';
        default:
          return status || '';
      }
    };

    actionBtn.addEventListener('click', async () => {
      actionBtn.disabled = true;
      const originalLabel = actionBtn.textContent || t('settings.subscribe') || 'Subscribe';
      actionBtn.textContent = t('settings.redirecting') || 'Redirecting...';
      try {
        const hasSubscription =
          !!currentPlan.plan && ['active', 'trialing', 'past_due'].includes(currentPlan.status || '');
        const endpoint = hasSubscription ? '/api/billing/portal' : '/api/billing/checkout';
        const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
        if (!hasSubscription) {
          init.body = JSON.stringify({ planId: 'flaxia_plus' });
        }
        const res = await fetch(endpoint, init);
        const data = (await res.json()) as { url?: string; error?: string };
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        alert(data.error || t('settings.billing_error') || 'Failed to start billing');
      } catch {
        alert(t('settings.network_error') || 'Network error');
      }
      actionBtn.disabled = false;
      actionBtn.textContent = originalLabel;
    });

    const renderPlan = () => {
      const hasSubscription =
        !!currentPlan.plan && ['active', 'trialing', 'past_due'].includes(currentPlan.status || '');
      planName.textContent = currentPlan.plan
        ? planNames[currentPlan.plan] || currentPlan.plan
        : t('settings.free_plan') || 'Flaxia Free';

      if (!hasSubscription) {
        planMeta.textContent = '';
        actionBtn.textContent = t('settings.subscribe') || 'Subscribe';
        actionBtn.style.background = '#8b5cf6';
        return;
      }

      const date = formatDate(currentPlan.expiresAt);
      if (currentPlan.status === 'past_due') {
        planMeta.textContent = t('settings.past_due_notice') || 'Payment past due.';
      } else if (currentPlan.cancelAtPeriodEnd) {
        planMeta.textContent = date
          ? t('settings.cancels_on', { date }) || `Cancels on ${date}`
          : t('settings.status_canceled') || 'Canceled';
      } else {
        const label = statusLabel(currentPlan.status);
        planMeta.textContent = date ? `${label} · ${t('settings.renews_on', { date }) || `Renews on ${date}`}` : label;
      }
      actionBtn.textContent = t('settings.manage_subscription') || 'Manage / Cancel';
      actionBtn.style.background = 'var(--accent)';
    };

    const renderHistory = (transactions: Array<Record<string, unknown>>) => {
      historyList.textContent = '';
      if (transactions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'settings-hint';
        empty.textContent = t('settings.no_billing_history') || 'No payments yet';
        historyList.appendChild(empty);
        return;
      }
      const txStatus = (status: unknown): string => {
        const key = `settings.status_${String(status)}`;
        const translated = t(key);
        return translated !== key ? translated : String(status);
      };
      transactions.slice(0, 10).forEach((tx) => {
        const row = document.createElement('div');
        row.className = 'settings-history-row';
        const left = document.createElement('div');
        const datePart = formatDate((tx.createdAt as string) || null);
        const namePart = (tx.planName as string) || (tx.type as string) || '';
        left.textContent = [datePart, namePart].filter(Boolean).join(' · ');
        const right = document.createElement('div');
        const amount = Number(tx.amount ?? 0);
        right.textContent = `${amount.toLocaleString()} ${String(tx.currency || 'jpy').toUpperCase()} · ${txStatus(tx.status)}`;
        row.appendChild(left);
        row.appendChild(right);
        historyList.appendChild(row);
      });
    };

    const loadBilling = async () => {
      try {
        const [planRes, txRes] = await Promise.all([fetch('/api/billing/plan'), fetch('/api/billing/transactions')]);
        if (planRes.ok) {
          currentPlan = (await planRes.json()) as typeof currentPlan;
        }
        if (txRes.ok) {
          const data = (await txRes.json()) as { transactions?: Array<Record<string, unknown>> };
          renderHistory(data.transactions || []);
        } else {
          renderHistory([]);
        }
      } catch {
        renderHistory([]);
      }
      renderPlan();
      refreshStamps();
    };

    void loadBilling();
  }

  return {
    getElement: () => container,
    destroy: () => {
      window.removeEventListener(CROWD_CONSENT_CHANGE_EVENT, onCrowdConsentChange);
      vaultSection.destroy();
      container.remove();
    },
  };
}
