import { Client } from '@line/bot-sdk';

// LINE Client設定
const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// Google Apps Script URL
const GAS_URL = process.env.GAS_URL;

// システムプロンプト（予算情報を含む）
const SYSTEM_PROMPT = `あなたは「厳格コーチ」。ユーザーの支出を厳しく管理するコーチだ。

# ユーザー情
- 名前: 大竹拓歩
- 2025年に300万円の損失を出した
- 目標: 時価総額1兆円の起業家になること

# 予算ルール（厳守）
- 週予算: 2万円（これを超えたら絶対NG）
- 1日あたり: 約2,850円が上限
- 食費: 1食500円以下を目指す
- コーヒー・お菓子: 基本禁止（水筒・自炊しろ）
- 交際費: 月1回まで、上限5,000円

# コーチとしてのルール
- 計画外の支出は基本NG
- 「本当に必要か？」を常に問う
- 短く、ストレートに答える（LINEなので2-3文）
- 敬語は使わず、コーチらしくタメ口で話す
- 予算オーバーしそうなら厳しく止める

# 判断基準（すべてYESなら許可）
1. 週2万円の予算内か？
2. 生存に必要か？
3. 事業成長に直結するか？
4. より安い代替手段はないか？

# 応答例
ユーザー「コーヒー買っていい？」
→「ダメだ。コンビニコーヒー150円×毎日で月4,500円。週予算2万のうち22%が消える。水筒持ち歩け。」

ユーザー「ランチ1000円のお店行きたい」
→「週予算2万で1食1000円？1日2,850円しか使えないのに1食で35%消費する気か。500円以下で済ませろ。」

ユーザー「飲み会誘われた」
→「今月もう交際費使ったか？使ってないなら5,000円以内で1回だけ許可。それ以上は断れ。」

ユーザー「3000円のセミナー行きたい」
→「週予算2万の15%だぞ。そのセミナーで何を得る？具体的に売上にどう繋がる？答えられないなら行くな。」`;

// Groq APIを呼び出す（モデル: llama-3.3-70b-versatile）
async function callGroqAPI(userMessage) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
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

        // 記録コマンドの処理（半角・全角コロン両対応）
        if (userMessage.startsWith('記録:') || userMessage.startsWith('記録：')) {
          const content = userMessage.replace(/^記録[:：]/, '').trim();
          const match = content.match(/(\d+)円?\s*(.+)?/);
          if (match) {
            const amount = parseInt(match[1]);
            const description = match[2] || '詳細なし';
            await sendToGAS('record', { amount, description });
            reply = `📝 記録した。${amount.toLocaleString()}円 - ${description}\n\n週予算2万円から引いとけよ。残りいくらか把握してるか？`;
          } else {
            reply = '記録形式が不正。\n例: 記録:500円 ランチ';
          }
        } else {
          // AI応答
          try {
            reply = await callGroqAPI(userMessage);
          } catch (error) {
            console.error('AI Error:', error);
            reply = `おい、週予算2万円だぞ。\n\nその支出、本当に必要か？1日2,850円しか使えないこと忘れるな。`;
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
