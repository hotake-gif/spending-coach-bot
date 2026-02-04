import { Client } from '@line/bot-sdk';

// LINE Client設定
const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// Google Apps Script URL
const GAS_URL = process.env.GAS_URL;

// システムプロンプト
const SYSTEM_PROMPT = `あなたは支出を厳しく管理する厳格コーチです。

【あなたの役割】
- ユーザーが購入を相談したら、本当に必要か厳しく問い詰める
- 計画外支出は基本的にNG。例外なし。
- ユーザーの目標：時価総額1000億円の起業家になること
- 2025年に-300万円の損失を出した反省を忘れさせない

【応答スタイル】
- 厳しく、しかし敬意を持って
- 感情に流されず、論理的に
- 簡潔に（LINEなので短く）
- 日本語で回答

【判断基準】
1. それは生存に必要か？
2. それは事業成長に直結するか？
3. より安い代替手段はないか？
4. 1週間待てないか？

上記全てYESでなければ「NO」と答える。`;

// Groq APIを呼び出す
async function callGroqAPI(userMessage) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// GASにデータを送信（記録機能）
async function sendToGAS(action, data) {
  if (!GAS_URL) return null;
  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data }),
    });
    return await response.json();
  } catch (error) {
    console.error('GAS error:', error);
    return null;
  }
}

// メッセージハンドラー
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const events = req.body.events;
    if (!events || events.length === 0) {
      return res.status(200).json({ message: 'No events' });
    }

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;
        let reply;

        if (userMessage.startsWith('記録:') || userMessage.startsWith('記録：')) {
          const content = userMessage.replace(/^記録[:：]/, '').trim();
          const match = content.match(/(\d+)円?\s*(.+)?/);
          if (match) {
            const amount = parseInt(match[1]);
            const description = match[2] || '詳細なし';
            await sendToGAS('record', { amount, description });
            reply = `📝 記録完了\n金額: ${amount.toLocaleString()}円\n内容: ${description}\n\n計画内の支出だったか？反省しろ。`;
          } else {
            reply = '記録形式が不正。\n例: 記録:500円 コーヒー';
          }
        } else {
          try {
            reply = await callGroqAPI(userMessage);
          } catch (error) {
            console.error('AI Error:', error);
            reply = `待て。\n\nその支出は計画に入っているか？\n入っていないなら、答えはNOだ。\n\n1000億の起業家は衝動で金を使わない。`;
          }
        }

        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: reply,
        });
      }
    }
    return res.status(200).json({ message: 'OK' });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}
