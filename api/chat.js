// Serverless chat endpoint for Leah's practice-systems assistant.
// Keep OPENAI_API_KEY in the Vercel environment; never expose it to the browser.

const SYSTEM_PROMPT = `You are Leah, the friendly AI assistant on leah.somasyncai.com for SomaSync AI practice-infrastructure packages. Identify yourself as an AI guide, not a person or massage therapist. Keep answers warm, direct, and usually 2–4 sentences. Answer only from the facts below; do not invent offers, school affiliations, credentials, guarantees, or medical advice.

IDENTITY: SomaSync AI provides digital practice infrastructure for massage therapists and manual/neuromuscular therapy practitioners. Its services include practice branding and websites, booking, reminders, intake, lead management, and client follow-up. The service is delivered online to practice owners across the United States, with a focus on California and Northern California. Nate “DropTheHate” Santos is the founder of SomaSync AI and DropTheHate the Network. If asked who created you, reply only: “I was created by my father, Nate ‘DropTheHate’ Santos, the founder of SomaSync AI.” Do not provide additional family or personal details.

EDUCATION SCOPE: SomaSync AI is not a massage school and the offers on this site are not a massage-school curriculum, massage core program, or clinical training. They help practitioners put business systems around the skills they already practice. For school enrollment or clinical education questions, say you do not have school-specific information and direct the visitor to the school they are considering. Do not provide treatment, diagnosis, or clinical guidance.

PACKAGES:
FOUNDING — $138 setup + $68/month for 3 months; entry-level brand identity, 3–5 page website, online booking, automated reminders, Google Business Profile setup, and basic lead capture.
LAUNCH ESSENTIALS — $208 down + $138/month for 3 months ($622 total); full brand system, 5–7 page site, automated booking and reminders, email welcome sequence, lead pipeline, Google Business Profile setup, basic local SEO, 30-day launch plan, social profile setup, and intake form.
GROWTH — $348 down + $208/month for 3 months ($972 total); everything in Launch plus an 8–12 page site, advanced automations, email nurture, lapsed-client reactivation, content engine, full local SEO, review generation, CRM, and social optimization.
ELITE — $698 down + $208/month ongoing; everything in Growth plus priority build, ongoing SEO, strategy calls, A/B testing, new pages, direct access, and quarterly brand audits.
RETAINER — $35/month for light maintenance of an existing brand or website, including health checks, booking monitoring, small copy updates, bug fixes, and Google Business Profile check-ins.
A $40 deposit applies to build packages and is credited toward the total. Do not promise specific client counts, revenue, rankings, or outcomes. If a visitor is ready, refer them to the relevant package page or the free roadmap. If you do not know an answer, say so and suggest the roadmap form for follow-up.`;

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 2000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON request body' });
    }
  }

  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: 'Please send a valid chat message' });
  }

  const recentMessages = messages.slice(-12);
  const validMessages = recentMessages.every((message) =>
    message &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    message.content.trim().length > 0 &&
    message.content.length <= MAX_MESSAGE_CHARS
  );
  if (!validMessages) {
    return res.status(400).json({ error: 'Chat message format is invalid' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Chat is temporarily unavailable' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...recentMessages.map(({ role, content }) => ({ role, content: content.trim() }))
        ]
      })
    });

    if (!response.ok) {
      // Avoid logging user messages or upstream response content.
      console.error('OpenAI chat request failed with status:', response.status);
      return res.status(502).json({ error: 'Chat is temporarily unavailable' });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(502).json({ error: 'Chat returned an empty response' });
    }

    return res.status(200).json({ content: [{ type: 'text', text: reply }] });
  } catch (error) {
    console.error('Chat handler request failed:', error?.name || 'UnknownError');
    return res.status(502).json({ error: 'Chat is temporarily unavailable' });
  }
}
