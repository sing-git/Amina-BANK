// One async caller per provider. Each returns raw model text (expected JSON).
// A provider whose key is missing returns null so the generator just skips it.
import Anthropic from "@anthropic-ai/sdk";
import type { SyntheticModel } from "../../types.js";

export interface Provider {
  id: SyntheticModel;
  available: () => boolean;
  generate: (system: string, user: string) => Promise<string>;
}

export const providers: Provider[] = [
  {
    id: "claude",
    available: () => !!process.env.ANTHROPIC_API_KEY,
    generate: async (system, user) => {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      const res = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: user }],
      });
      return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    },
  },
  {
    id: "openai",
    available: () => !!process.env.OPENAI_API_KEY,
    generate: async (system, user) => {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      return data.choices[0]!.message.content;
    },
  },
  {
    id: "gemini",
    available: () => !!process.env.GEMINI_API_KEY,
    generate: async (system, user) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
      return data.candidates[0]!.content.parts.map((p) => p.text).join("");
    },
  },
  {
    id: "azure",
    available: () => !!process.env.AZURE_OPENAI_API_KEY && !!process.env.AZURE_OPENAI_ENDPOINT,
    generate: async (system, user) => {
      // endpoint should already include deployment + api-version, e.g.
      // https://<resource>.openai.azure.com/openai/deployments/<dep>/chat/completions?api-version=2024-08-01-preview
      const res = await fetch(process.env.AZURE_OPENAI_ENDPOINT!, {
        method: "POST",
        headers: { "api-key": process.env.AZURE_OPENAI_API_KEY!, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error(`Azure ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      return data.choices[0]!.message.content;
    },
  },
];
