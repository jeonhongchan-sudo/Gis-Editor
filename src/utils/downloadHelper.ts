import { encodeText } from './encoding';

/**
 * Triggers a text file download in the browser with optional encoding
 */
export function downloadTextFile(
  content: string, 
  filename: string, 
  encoding: 'utf-8' | 'euc-kr' | 'utf-8-bom' = 'utf-8',
  mimeType: string = 'text/plain'
) {
  const bytes = encodeText(content, encoding);
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
  downloadBlob(blob, filename);
}

/**
 * Triggers a Blob download in the browser
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
