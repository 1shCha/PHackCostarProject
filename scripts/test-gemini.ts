// Checks that the Gemini key works with an image.
// Run: npx tsx --env-file=.env.local scripts/test-gemini.ts [path/to/photo.jpg]
// With no path, it uses the first cached panorama view of Suite 900 (run fetch-spatial first).

import { GoogleGenAI } from "@google/genai";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { downloadPanos, getModel } from "../src/lib/spatial/matterport";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

async function pickImage(): Promise<string> {
  if (process.argv[2]) return process.argv[2];
  const dir = path.join(process.cwd(), "cache", "matterport", "mXRDfAHA7iB", "panos");
  if (!existsSync(dir) || !readdirSync(dir).length) {
    const first = (await getModel("mXRDfAHA7iB")).panoLocations[0].id;
    const panos = await downloadPanos("mXRDfAHA7iB", [first]); // just one photo, 4 views
    return panos[first][0];
  }
  return path.join(dir, readdirSync(dir).filter((f) => f.endsWith(".jpg"))[0]);
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY in .env.local");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const file = await pickImage();
  console.log(`Asking ${MODEL} about ${file}`);

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      { inlineData: { mimeType: "image/jpeg", data: readFileSync(file).toString("base64") } },
      {
        text:
          "This is one view from a 360° photo inside a commercial space. What kind of room is it? " +
          'Reply as JSON: {"label": string, "confidence": number between 0 and 1, "features": string[], "evidence": string}',
      },
    ],
    config: { responseMimeType: "application/json" },
  });
  console.log(res.text);
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
