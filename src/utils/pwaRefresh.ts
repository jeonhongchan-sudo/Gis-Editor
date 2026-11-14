/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerSW } from 'virtual:pwa-register';

let swRegistration: ServiceWorkerRegistration | null = null;
let initialized = false;

export function initPwaRegistration(): void {
  if (typeof window === 'undefined') return;

  try {
    const curUrl = new URL(window.location.href);
    if (curUrl.searchParams.has('_v')) {
      curUrl.searchParams.delete('_v');
      window.history.replaceState(null, '', curUrl.pathname + curUrl.search + curUrl.hash);
    }
  } catch {
    // ignore URL parse issues
  }

  if (initialized || !('serviceWorker' in navigator)) {
    return;
  }
  initialized = true;

  try {
    registerSW({
      immediate: true,
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        swRegistration = registration;
      },
      onRegisterError(err) {
        console.warn('ServiceWorker registration error:', err);
      }
    });
  } catch (err) {
    console.warn('PWA register skipped:', err);
  }

  const checkForUpdate = () => {
    if (navigator.onLine && swRegistration) {
      swRegistration.update().catch(() => {});
    }
  };

  window.addEventListener('online', checkForUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate();
    }
  });
}

/**
 * Verifies live network reachability before clearing Service Worker & Cache Storage
 * so offline usage and IndexedDB user data remain 100% safe.
 */
export async function forceRefreshAppFromServer(): Promise<{ refreshed: boolean; reason?: 'offline' | 'error' }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { refreshed: false, reason: 'offline' };
  }

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`/?_pwa_refresh=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
    window.clearTimeout(timer);

    if (!res.ok) {
      return { refreshed: false, reason: 'offline' };
    }
  } catch {
    return { refreshed: false, reason: 'offline' };
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister().catch(() => false)));
    }
    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map(key => caches.delete(key).catch(() => false)));
    }
  } catch (err) {
    console.warn('Cache cleanup warning during force refresh:', err);
  }

  const url = new URL(window.location.href);
  url.searchParams.set('_v', Date.now().toString());
  window.location.replace(url.toString());
  return { refreshed: true };
}
