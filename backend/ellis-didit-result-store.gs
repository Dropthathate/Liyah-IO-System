/**
 * Ellis Didit status store.
 * Deploy as a Google Apps Script web app. Keep both properties in Script Properties:
 *   ELLIS_DIDIT_STORE_TOKEN (random 32+ byte secret shared with Vercel)
 *   ELLIS_DIDIT_SPREADSHEET_ID (dedicated practice-owned spreadsheet)
 *
 * This append-only log stores status metadata only. It deliberately discards the
 * Didit decision object, identity details/images, health/intake information, and
 * the request body after validation.
 */
const ELLIS_DIDIT_HEADERS = [
  'event_id',
  'session_id',
  'booking_reference',
  'workflow_id',
  'environment',
  'didit_status',
  'status_key',
  'event_timestamp_unix',
  'created_at_unix',
  'received_at_utc',
];

const ELLIS_DIDIT_STATUS_KEYS = {
  'Approved': 'approved',
  'Declined': 'declined',
  'In Review': 'in_review',
  'In Progress': 'in_progress',
  'Not Started': 'not_started',
  'Abandoned': 'abandoned',
  'Expired': 'expired',
  'Kyc Expired': 'kyc_expired',
  'Resubmitted': 'resubmitted',
  'Awaiting User': 'awaiting_user',
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return json_({ ok: false, code: 'busy' });

  try {
    const raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!raw || Utilities.newBlob(raw).getBytes().length > 8192) return json_({ ok: false, code: 'invalid_request' });

    let body;
    try {
      body = JSON.parse(raw);
    } catch (_error) {
      return json_({ ok: false, code: 'invalid_json' });
    }

    const properties = PropertiesService.getScriptProperties();
    const expectedToken = properties.getProperty('ELLIS_DIDIT_STORE_TOKEN') || '';
    if (expectedToken.length < 32) return json_({ ok: false, code: 'store_not_configured' });
    if (!constantTimeEquals_(body && body.token, expectedToken)) return json_({ ok: false, code: 'unauthorized' });

    const record = body && body.outcome;
    if (!validOutcome_(record)) return json_({ ok: false, code: 'invalid_outcome' });

    const spreadsheetId = properties.getProperty('ELLIS_DIDIT_SPREADSHEET_ID') || '';
    if (!spreadsheetId) return json_({ ok: false, code: 'store_not_configured' });

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheetName = properties.getProperty('ELLIS_DIDIT_SHEET_NAME') || 'DIDIT_VERIFICATION_EVENTS';
    const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
    if (!ensureHeaders_(sheet)) return json_({ ok: false, code: 'schema_mismatch' });

    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const eventIds = sheet.getRange(2, 1, lastRow - 1, 1);
      const duplicate = eventIds.createTextFinder(record.eventId).matchEntireCell(true).findNext();
      if (duplicate) return json_({ ok: true, duplicate: true });
    }

    sheet.appendRow([
      record.eventId,
      record.sessionId,
      record.bookingReference,
      record.workflowId,
      record.environment,
      record.status,
      record.statusKey,
      record.eventTimestamp,
      record.createdAt === null ? '' : record.createdAt,
      new Date().toISOString(),
    ]);
    return json_({ ok: true, duplicate: false });
  } catch (_error) {
    // Do not log webhook body or provider response: errors can contain personal data.
    return json_({ ok: false, code: 'store_error' });
  } finally {
    lock.releaseLock();
  }
}

function validOutcome_(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const allowed = ['bookingReference', 'createdAt', 'environment', 'eventId', 'eventTimestamp', 'sessionId', 'status', 'statusKey', 'workflowId'];
  const keys = Object.keys(record).sort();
  if (keys.length !== allowed.length || keys.some(function (key, index) { return key !== allowed[index]; })) return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuid.test(String(record.eventId || ''))
    && uuid.test(String(record.sessionId || ''))
    && uuid.test(String(record.bookingReference || ''))
    && uuid.test(String(record.workflowId || ''))
    && ['live', 'sandbox'].indexOf(record.environment) !== -1
    && Object.prototype.hasOwnProperty.call(ELLIS_DIDIT_STATUS_KEYS, record.status)
    && ELLIS_DIDIT_STATUS_KEYS[record.status] === record.statusKey
    && Number.isSafeInteger(record.eventTimestamp)
    && record.eventTimestamp > 0
    && (record.createdAt === null || (Number.isSafeInteger(record.createdAt) && record.createdAt > 0));
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ELLIS_DIDIT_HEADERS.length).setValues([ELLIS_DIDIT_HEADERS]);
    sheet.setFrozenRows(1);
    return true;
  }
  if (sheet.getLastColumn() < ELLIS_DIDIT_HEADERS.length) return false;
  const actual = sheet.getRange(1, 1, 1, ELLIS_DIDIT_HEADERS.length).getValues()[0];
  return ELLIS_DIDIT_HEADERS.every(function (header, index) { return actual[index] === header; });
}

function constantTimeEquals_(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || candidate.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
