/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as XLSX from 'xlsx';

/**
 * Parse an Excel file ArrayBuffer into workbook sheets
 */
export function parseExcelWorkbook(buffer: ArrayBuffer): {
  sheetNames: string[];
  getSheetRows: (sheetName: string) => (string | number)[][];
} {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    cellNF: false,
    cellText: false
  });

  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error('엑셀 파일에 유효한 시트가 없습니다.');
  }

  const getSheetRows = (sheetName: string): (string | number)[][] => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    
    // Convert to 2D array: rows x columns
    const rawRows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false
    });

    // Clean up empty trailing cells and rows
    return rawRows.map(row => 
      row.map(cell => (cell === null || cell === undefined ? '' : String(cell).trim()))
    ).filter(row => row.some(cell => cell !== ''));
  };

  return {
    sheetNames,
    getSheetRows
  };
}
