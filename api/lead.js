const LEAD_ENDPOINT = 'https://script.google.com/macros/s/AKfycbx4UEtWIfzW63X3DNj7f19ROw4GgQoDufOqjTZdIZlTY6JWuVTURtrDGQSVKOAN7MUxzw/exec';
const VALID_STAGES = new Set(['student', 'new', 'established', 'scaling']);
const VALID_SOURCES = new Set(['aaliyah-roadmap', 'aaliyah-booking-request']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseBody(body) {
  if (typeof body === 'string') return JSON.parse(body);
  return body || {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = parseBody(req.body);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }

  const fname = String(payload.fname || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const stage = String(payload.stage || '').trim();
  const source = String(payload.source || 'aaliyah-roadmap').trim();
  const phone = String(payload.phone || '').trim();
  const packageName = String(payload.package || '').trim();
  const notes = String(payload.notes || '').trim();

  if (!fname || fname.length > 100 || !EMAIL_PATTERN.test(email) || !VALID_SOURCES.has(source)) {
    return res.status(400).json({ success: false, error: 'Please provide a valid name and email address.' });
  }

  if (source === 'aaliyah-roadmap' && !VALID_STAGES.has(stage)) {
    return res.status(400).json({ success: false, error: 'Please select your current practice stage.' });
  }

  if (phone.length > 40 || packageName.length > 100 || notes.length > 3000) {
    return res.status(400).json({ success: false, error: 'One or more fields are too long. Please shorten your response and try again.' });
  }

  try {
    const upstream = await fetch(LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fname,
        email,
        stage,
        source,
        phone,
        package: packageName,
        notes,
        timestamp: new Date().toISOString()
      })
    });

    const responseText = await upstream.text();
    let responseData = null;
    try { responseData = JSON.parse(responseText); } catch { /* Apps Script responses may be plain text. */ }

    if (!upstream.ok || responseData?.success === false) {
      console.error('Lead endpoint rejected roadmap submission', upstream.status, responseText.slice(0, 500));
      return res.status(502).json({ success: false, error: 'We could not save your request. Please try again.' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Lead proxy error', error);
    return res.status(502).json({ success: false, error: 'We could not reach the lead system. Please try again.' });
  }
}
