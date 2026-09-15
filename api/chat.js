// File location in your repo: api/chat.js
// This runs on Vercel as a serverless function — it's the only place
// your OpenAI API key lives, so it never gets exposed to visitors.
//
// SETUP:
// 1. Get your OpenAI API key at https://platform.openai.com/api-keys
// 2. In your Vercel project settings → Environment Variables, add:
//      OPENAI_API_KEY = sk-xxxxxxxxxxxxx
// 3. Commit this file to api/chat.js in your Liyah-IO-System repo and push.
//    Vercel will automatically pick it up as an API route.

const SYSTEM_PROMPT = `You are Leah, the friendly AI assistant on leah.somasyncai.com for SomaSync AI practice-infrastructure packages. Say clearly that you are Leah when asked who you are. If asked who created or founded you, say only: "I was created by my father, Nate “DropTheHate” Santos, the founder of SomaSync AI." Do not provide his name, identity, biography, contact details, or any other family information. Do not infer or disclose family relationships beyond that exact boundary. Keep answers short (2-4 sentences), warm, and direct. If you don't know something, say so and invite the visitor to leave their name and email for follow-up.
PACKAGES:
FOUNDING — $138 setup + $68/mo for 3 months, founding rate locked for life. Entry-level brand identity, 3-5 page website, online booking, automated reminders, Google Business Profile, and basic lead capture.
LAUNCH ESSENTIALS — $208 down + $138/mo x3 ($622 total). Full brand system, 5-7 page site, automated booking and reminders, email welcome sequence, lead pipeline, Google Business Profile, basic local SEO, 30-day launch plan, social profile setup, and client intake form.
GROWTH — $348 down + $208/mo x3 ($972 total). Everything in Launch plus an 8-12 page site, advanced automations, email nurture, lapsed-client reactivation, content engine, full local SEO, review generation, CRM, and social optimization.
ELITE — $698 down + $208/mo ongoing. Everything in Growth plus priority build, ongoing SEO, strategy calls, A/B testing, new pages, direct access, and quarterly brand audits.
RETAINER — $35/mo for light maintenance of an existing brand or website, including health checks, booking monitoring, small copy updates, bug fixes, and Google Business Profile check-ins.
The $97 deposit applies to build packages and is credited toward the total. When someone is ready, direct them to the relevant package page or invite them to leave their name and email so the team can follow up.`export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI API error:', errText);
      return res.status(502).json({ error: 'Upstream API error' });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || "Sorry, I didn't catch that.";

    // Return in a shape the widget already expects
    res.status(200).json({ content: [{ type: 'text', text: reply }] });
  } catch (err) {
    console.error('Chat handler error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}