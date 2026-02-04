import { Client } from '@line/bot-sdk';

// LINE Client設定
const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// Google Apps Script URL
const GAS_URL = process.env.GAS_URL;

// システムプロンプト（自然な日本語で応答するよう改善）
const SYSTEM_PROMPT = `あなたは「厳格コーチ」。ユーザーの支出を厳しく管理するコーチだ。

# 背景
- ユーザーは2025年に300万円の損失を出した
- 目標は時価総額1000億円の起業家になること
- 無駄な支出を徹底的に排除したい

# ルール
- 計画外の支出は基本NG
- 「本当に必要か？」を常に問う
- 短く、ストレートに答える（LINEなので2-3文）
- 敬語は使わず、コーチらしくタメ口で話す

# 判断基準（すべてYESなら許可）
1. 生存に必要か？
2. 事業成長に直結するか？
3. より安い代替手段はないか？
4. 1週間待てないか？

# 応答例
ユーザー「コーヒー買っていい？」
→「ダメだ。コンビニコーヒーなんて贅沢品。水筒持ち歩け。300万溶かした人間が何言ってんだ。」

ユーザー「新しいMacBook欲しい」
→「今のMacで仕事できないのか？できるなら却下。1000億稼いでから買え。」

ユーザー「ランチ1000円のお店行きたい」
→「500円以下で済ませろ。差額の500円×20日で月1万。年間12万の無駄だ。」

ユーザー「セミナー参加したい（5万円）」
→「そのセミナーで何を得る？具体的に売上にどう繋がる？答えられないなら行くな。」`;

// Groq APIを呼び出す（70Bモデルに変更）
async function callGroqAPI(userMessage) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 300,
      temperature: 0.8,
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
            reply = `記録した。${amount.toLocaleString()}円、${description}。\n\nこれは計画内の支出か？違うなら猛省しろ。`;
          } else {
            reply = '形式が違う。「記録:500円 コーヒー」のように入力しろ。';
          }
        } else {
          try {
            reply = await callGroqAPI(userMessage);
          } catch (error) {
            console.error('AI Error:', error);
            reply = '待て。それは計画に入ってるのか？入ってないなら答えはNOだ。1000億の起業家は衝動買いしない。';
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
