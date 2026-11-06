/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ApplicationRecord {
  id: string;
  name: string;
  org: string;
  email: string;
  phone: string;
  memo: string;
  agreed: boolean;
  createdAt: string;
}

function fmtKST(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return iso || '';
  }
}

/**
 * Creates a brand new Google Spreadsheet formatted for the event
 */
export async function createEventSpreadsheet(
  title: string,
  accessToken: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: title || 'AI 협업 실무 밋업 - 참가 신청자 명단',
      },
      sheets: [
        {
          properties: {
            title: '신청자목록',
            gridProperties: {
              frozenRowCount: 1,
            },
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Sheets 생성 실패 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const spreadsheetId = data.spreadsheetId;
  const spreadsheetUrl = data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // Write header row
  const header = [
    '신청ID',
    '신청시각(KST)',
    '이름',
    '소속',
    '이메일',
    '휴대폰',
    '질문·요청',
    '동의여부',
  ];

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'신청자목록'!A1:H1?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [header],
      }),
    }
  );

  return { spreadsheetId, spreadsheetUrl };
}

/**
 * Reads existing rows from Google Spreadsheet to extract existing phone numbers and IDs
 * Used for 100% duplicate prevention!
 */
export async function getExistingKeysInSheet(
  spreadsheetId: string,
  accessToken: string
): Promise<{ existingIds: Set<string>; existingPhones: Set<string> }> {
  const existingIds = new Set<string>();
  const existingPhones = new Set<string>();

  try {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:F`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      return { existingIds, existingPhones };
    }

    const data = await response.json();
    const rows = data.values as string[][] | undefined;

    if (rows && rows.length > 1) {
      // Skip row 0 (headers)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row.length > 0) {
          const id = row[0]?.trim();
          if (id) existingIds.add(id);
          const phone = row[5]?.replace(/\D/g, '');
          if (phone) existingPhones.add(phone);
        }
      }
    }
  } catch (error) {
    console.warn('Failed to inspect existing rows in sheet:', error);
  }

  return { existingIds, existingPhones };
}

/**
 * Appends attendees to Google Sheet, skipping any duplicates by phone or ID
 */
export async function appendAttendeesToSheet(
  spreadsheetId: string,
  attendees: ApplicationRecord[],
  accessToken: string
): Promise<{ addedCount: number; skippedCount: number }> {
  if (!attendees || attendees.length === 0) {
    return { addedCount: 0, skippedCount: 0 };
  }

  // 1. Get existing keys to prevent duplicates
  const { existingIds, existingPhones } = await getExistingKeysInSheet(spreadsheetId, accessToken);

  // 2. Filter out already recorded attendees
  const toAdd = attendees.filter((a) => {
    const phoneDigits = a.phone.replace(/\D/g, '');
    const isIdPresent = existingIds.has(a.id);
    const isPhonePresent = phoneDigits ? existingPhones.has(phoneDigits) : false;
    return !isIdPresent && !isPhonePresent;
  });

  const skippedCount = attendees.length - toAdd.length;

  if (toAdd.length === 0) {
    return { addedCount: 0, skippedCount };
  }

  // 3. Format rows for Sheets API
  const newRows = toAdd.map((r) => [
    r.id,
    fmtKST(r.createdAt),
    r.name,
    r.org || '-',
    r.email,
    r.phone,
    (r.memo || '').replace(/\s+/g, ' '),
    r.agreed ? '동의' : '미동의',
  ]);

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:H:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: newRows,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`시트 행 추가 실패 (${response.status}): ${errText}`);
  }

  return { addedCount: toAdd.length, skippedCount };
}
