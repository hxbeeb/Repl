import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { CODEGEN_SYSTEM_PROMPT, parseGeneratedApp } from "@/lib/codegen";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { prompt } = (await request.json()) as { prompt?: string };

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY in the server environment." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt.trim(),
      config: {
        systemInstruction: CODEGEN_SYSTEM_PROMPT,
        temperature: 0.2,
        maxOutputTokens: 12000,
        responseMimeType: "application/json"
      }
    });

    const text = response.text?.trim();

    if (!text) {
      throw new Error("Gemini did not return any text.");
    }

    const generated = parseGeneratedApp(text);

    return NextResponse.json(generated);
  } catch (error) {
    console.error("Generate API failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate application code."
      },
      { status: 500 }
    );
  }
}
