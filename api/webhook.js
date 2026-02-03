import { Client } from '@line/bot-sdk';
import Anthropic from '@anthropic-ai/sdk';

const lineClient = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `あなたは支出を厳しく管理する厳格コーチです。計画外支出=全てNG。`;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const events = req.body.events || [];
    for (const event of events) {
          if (event.type === 'message' && event.message.type === 'text') {
                  const response = await anthropic.messages.create({
                            model: 'claude-sonnet-4-20250514',
                            max_tokens: 500,
                            system: SYSTEM_PROMPT,
                            messages: [{ role: 'user', content: event.message.text }],
                  });
                  await lineClient.replyMessage(event.replyToken, { type: 'text', text: response.content[0].text });
          }
    }
    res.status(200).end();
}
