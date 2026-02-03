import { Client } from '@line/bot-sdk';
import Anthropic from '@anthropic-ai/sdk';

const lineClient = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GAS_URL = process.env.GAS_URL;

const SYSTEM_PROMPT = `あなたは支出を厳しく管理する厳格コーチです。

【あなたの役割】
- ユーザーが購入を相談したら、本当に必要か厳しく問い詰める
- 計画外支出は基本的にNG。例外なし。
- ユーザーの目標：時価総額1000億円の起業家になること
- 2025年に-300万円の損失を出した反省を忘れさせない

【支出記録コマンド】
ユーザーが「記録:」で始まるメッセージを送った場合、支出を記録します。
例: 「記録: 1500円 昼食 ラーメン」

【レスポンス形式】
支出相談の場合:
1. その支出が本当に必要か質問
2. 目標達成にどう影響するか指摘
3. 代替案があれば提案

記録の場合:
「【記録完了】金額: X円 / カテゴリ: Y / 内容: Z」と返答`;

async function recordExpense(amount, category, description) {
  if (!GAS_URL) { console.log('GAS_URL not configured'); return false; }
  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, category, description, date: new Date().toISOString() })
    });
    const result = await response.json();
    return result.success;
  } catch (error) { console.error('Failed to record expense:', error); return false; }
}

function parseRecordCommand(text) {
  const match = text.match(/^記録[:：]\s*(\d+)円?\s+(\S+)\s+(.+)/);
  if (match) { return { amount: parseInt(match[1]), category: match[2], description: match[3] }; }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userText = event.message.text;
      const recordData = parseRecordCommand(userText);
      if (recordData) {
        const success = await recordExpense(recordData.amount, recordData.category, recordData.description);
        const replyText = success
          ? `【記録完了】\n金額: ${recordData.amount}円\nカテゴリ: ${recordData.category}\n内容: ${recordData.description}\n\n引き続き支出管理を徹底しましょう！`
          : `【記録失敗】システムエラーが発生しました。再度お試しください。`;
        await lineClient.replyMessage(event.replyToken, { type: 'text', text: replyText });
        continue;
      }
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText }],
      });
      await lineClient.replyMessage(event.replyToken, { type: 'text', text: response.content[0].text });
    }
  }
  res.status(200).end();
}
