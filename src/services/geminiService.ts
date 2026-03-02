import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export interface Message {
  id: string;
  role: "user" | "model";
  content: string;
  timestamp: number;
  error?: boolean;
  status?: 'sending' | 'sent' | 'error';
  type?: 'text' | 'image';
  imageUrl?: string;
  groundingUrls?: { uri: string; title: string }[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

export interface User {
  id: string;
  email: string;
  membership: 'free' | 'pro';
}

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    if (!API_KEY) {
      throw new Error("GEMINI_API_KEY is not defined");
    }
    this.ai = new GoogleGenAI({ apiKey: API_KEY });
  }

  async chat(message: string, history: Message[] = [], systemInstruction?: string, model: string = "gemini-3.1-pro-preview") {
    const chat = this.ai.chats.create({
      model: model,
      config: {
        systemInstruction: systemInstruction || "You are Aura, a highly intelligent and helpful AI assistant. You provide clear, concise, and accurate information. You are professional yet approachable. Use markdown for formatting when appropriate.",
      },
      history: history.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }))
    });

    const response = await chat.sendMessage({ message });
    return response.text;
  }

  async *chatStream(message: string, history: Message[] = [], useSearch: boolean = false, systemInstruction?: string, model: string = "gemini-3.1-pro-preview") {
    const chat = this.ai.chats.create({
      model: model,
      config: {
        systemInstruction: systemInstruction || "You are Aura, a highly intelligent and helpful AI assistant. You provide clear, concise, and accurate information. You are professional yet approachable. Use markdown for formatting when appropriate.",
        tools: useSearch ? [{ googleSearch: {} }] : undefined,
      },
      history: history.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }))
    });

    const result = await chat.sendMessageStream({ message });
    for await (const chunk of result) {
      const c = chunk as GenerateContentResponse;
      
      // Handle grounding metadata if available
      const groundingChunks = c.candidates?.[0]?.groundingMetadata?.groundingChunks;
      const urls = groundingChunks?.map(chunk => ({
        uri: chunk.web?.uri || '',
        title: chunk.web?.title || ''
      })).filter(u => u.uri);

      yield {
        text: c.text,
        groundingUrls: urls
      };
    }
  }

  async generateImage(prompt: string) {
    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }],
      },
    });

    if (!response.candidates?.[0]?.content?.parts) {
      throw new Error("Invalid response from image model");
    }

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const mimeType = part.inlineData.mimeType || 'image/png';
        return `data:${mimeType};base64,${part.inlineData.data}`;
      }
    }
    throw new Error("No image data returned from the model");
  }

  async textToSpeech(text: string) {
    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say clearly: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      // Gemini 2.5 Flash TTS returns raw PCM 16-bit at 24kHz.
      // We need to wrap it in a WAV header for the browser to play it.
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const pcmData = new Int16Array(bytes.buffer);
      const wavBuffer = this.encodeWAV(pcmData, 24000);
      const wavBase64 = btoa(String.fromCharCode(...new Uint8Array(wavBuffer)));
      
      return `data:audio/wav;base64,${wavBase64}`;
    }
    throw new Error("No audio data returned");
  }

  private encodeWAV(samples: Int16Array, sampleRate: number) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    for (let i = 0; i < samples.length; i++) {
      view.setInt16(44 + i * 2, samples[i], true);
    }

    return buffer;
  }

  async analyzeImage(imagePrompt: string, base64Image: string, mimeType: string) {
    const response = await this.ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          { text: imagePrompt || "What's in this image?" },
        ],
      },
    });
    return response.text;
  }

  async generateTitle(messages: Message[]) {
    try {
      const prompt = `Based on the following conversation, generate a short, descriptive title (max 6 words). Return ONLY the title text, no quotes or extra characters.\n\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      return response.text?.trim() || "New Conversation";
    } catch (error) {
      console.error("Error generating title:", error);
      return "New Conversation";
    }
  }
}

export const gemini = new GeminiService();
