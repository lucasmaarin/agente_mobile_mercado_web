import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Arquivo de áudio ausente." }, { status: 400 });
  }

  const result = await openai.audio.transcriptions.create({
    file,
    model:    "whisper-1",
    language: "pt",
  });

  return NextResponse.json({ text: result.text });
}
