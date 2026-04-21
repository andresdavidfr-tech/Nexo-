import { GoogleGenAI } from "@google/genai";

// Initialize carefully to avoid top-level crashes in some environments
const getApiKey = () => {
  try {
    return process.env.GEMINI_API_KEY || '';
  } catch (e) {
    return '';
  }
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });

export async function summarizeCommunication(content: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Resume el siguiente comunicado escolar en una frase corta y destaca fechas o acciones importantes: "${content}"`,
      config: {
        systemInstruction: "Eres un asistente escolar que resume comunicados para padres ocupados. Sé conciso y directo.",
      },
    });
    return response.text || "No se pudo generar el resumen.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Error al generar el resumen.";
  }
}

export async function askAISearch(query: string, context: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Contexto escolar (estudiantes, comunicados, eventos): ${context}\n\nPregunta del usuario: "${query}"`,
      config: {
        systemInstruction: "Eres un asistente de IA para una aplicación escolar llamada 'Nexo'. Tu objetivo es ayudar a padres y personal escolar a encontrar información rápidamente basándote en el contexto proporcionado. Si no sabes algo, admítelo amablemente. Responde siempre en español. Sé amable, profesional y conciso.",
      },
    });
    return response.text || "Lo siento, no pude procesar tu solicitud en este momento.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Hubo un error al conectar con el asistente de IA.";
  }
}
