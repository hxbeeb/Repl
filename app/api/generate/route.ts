import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { CODEGEN_SYSTEM_PROMPT, parseGeneratedApp } from "@/lib/codegen";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { prompt, model } = (await request.json()) as { prompt?: string; model?: string };

    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY in the server environment." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const allowedModels = ["gemini-2.5-flash", "gemini-2.5-pro"];
    const selectedModel = allowedModels.includes(model ?? "") ? model! : "gemini-2.5-flash";

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt.trim(),
      config: {
        systemInstruction: CODEGEN_SYSTEM_PROMPT,
        temperature: 0.3,
        maxOutputTokens: selectedModel === "gemini-2.5-pro" ? 65536 : 65000,
        // Give Pro a thinking budget for better architecture on complex apps
        ...(selectedModel === "gemini-2.5-pro"
          ? { thinkingConfig: { thinkingBudget: 8000 } }
          : {}),
      },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("Gemini did not return any text.");

    console.log(`[generate] model=${selectedModel} length=${text.length}`);

    const generated = parseGeneratedApp(text);
    return NextResponse.json(generated);
  } catch (error) {
    console.error("Generate API failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate application code." },
      { status: 500 }
    );
  }
}
