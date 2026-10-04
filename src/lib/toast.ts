export function showToast(message: string, isError: boolean = false): void {
  const toast = document.createElement('div');
  toast.className = `playroom-toast${isError ? ' playroom-toast--error' : ''}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('playroom-toast--leaving');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
