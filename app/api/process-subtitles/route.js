import { NextResponse } from 'next/server';

// 重要提示：Vercel Serverless Function 默认有请求体大小限制（通常是 4.5MB）。
// 对于更长的音频，您可能需要配置此项，或者最终切换到 Google File API。
export const maxDuration = 60; // 允许后端运行更长时间（最多 60 秒，取决于您的 Vercel 计划）

export async function POST(request) {
  try {
    const body = await request.json();
    const { rawText, audioDuration, audioBase64, audioMimeType } = body;

    // 这里我们从 Vercel 的环境变量中安全地读取 API Key
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Missing GEMINI_API_KEY environment variable" }, { status: 500 });
    }

    const prompt = `I am providing an audio file and its English transcript. 
    Transcript: ${rawText}

    Task:
    1. Segment the transcript into logical subtitle sentences (roughly 5-12 words each).
    2. Listen to the audio to determine the PRECISE start and end times (in seconds) for each segment.
    3. Translate each segment into natural Chinese.
    4. Return ONLY a valid JSON array. Do not output any other text or markdown.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ 
        parts: [
          { text: prompt },
          // 包含音频数据让 AI 听取
          ...(audioBase64 ? [{ inlineData: { mimeType: audioMimeType || "audio/mp3", data: audioBase64 } }] : [])
        ] 
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              start: { type: "NUMBER" },
              end: { type: "NUMBER" },
              en: { type: "STRING" },
              zh: { type: "STRING" }
            }
          }
        }
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
       const errorData = await response.text();
       console.error("Google API Error:", errorData);
       return NextResponse.json({ error: "Failed to generate content from Google" }, { status: response.status });
    }

    const data = await response.json();
    const segmentsText = data.candidates[0].content.parts[0].text;
    const segments = JSON.parse(segmentsText);

    return NextResponse.json({ segments });

  } catch (error) {
    console.error("Serverless API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}