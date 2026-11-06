/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { encodeText } from './encoding';

/**
 * Triggers a text file download in the browser with optional encoding.
 * Attempts to use showSaveFilePicker if available to allow user to pick location.
 */
export async function downloadTextFile(
  content: string, 
  filename: string, 
  encoding: 'utf-8' | 'euc-kr' | 'utf-8-bom' = 'utf-8',
  mimeType: string = 'text/plain'
) {
  const bytes = encodeText(content, encoding);
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
  await smartSaveFile(blob, filename);
}

/**
 * Triggers a Blob download in the browser.
 * Attempts to use showSaveFilePicker if available to allow user to pick location.
 */
export async function downloadBlob(blob: Blob, filename: string) {
  await smartSaveFile(blob, filename);
}

/**
 * Common logic to either use File System Access API or fallback to standard download
 */
async function smartSaveFile(blob: Blob, suggestedName: string) {
  // Use File System Access API only on Desktop Chrome/Edge
  // On many mobile browsers, this exists but behaves poorly or triggers double downloads
  const isDesktop = !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  if (isDesktop && 'showSaveFilePicker' in window) {
    try {
      const ext = suggestedName.split('.').pop() || '';
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [{
          description: suggestedName,
          accept: { [blob.type || 'application/octet-stream']: [`.${ext}`] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.warn('File system picker failed, falling back to legacy download', err);
    }
  }

  // Legacy download fallback (Reliable for mobile)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  
  // Cleanup with delay to ensure browser processed the click
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
