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
                            
                                    // 「記録:」で始まる場合は支出記録
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
                                                  // 通常のメッセージはAIに問い合わせ
                                                  try {
                                                                  reply = await callGroqAPI(userMessage);
                                                  } catch (error) {
                                                                  console.error('AI Error:', error);
                                                                  reply = `待て。\n\nその支出は計画に入っているか？\n入っていないなら、答えはNOだ。\n\n1000億の起業家は衝動で金を使わない。`;
                                                  }
                                    }
                            
                                    // LINEに返信
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
}import { Client } from '@line/bot-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const lineClient = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
                  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                  const chat = model.startChat({
                            history: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT }] }, { role: 'model', parts: [{ text: '了解しました。厳格コーチとして支出管理をサポートします。' }] }],
                  });
                  const result = await chat.sendMessage(userText);
                  const responseText = result.response.text();
                  await lineClient.replyMessage(event.replyToken, { type: 'text', text: responseText });
          }
    }
    res.status(200).end();
}
