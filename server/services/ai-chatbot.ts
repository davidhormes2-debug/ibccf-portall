import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface ChatContext {
  userName?: string;
  caseStatus?: string;
  withdrawalStage?: number;
  previousMessages?: Array<{ role: 'user' | 'admin' | 'bot'; content: string }>;
}

const SYSTEM_PROMPT = `You are a helpful customer support AI assistant for the International Blockchain Community Complaints Forum (IBCCF). Your role is to assist users with their fraud recovery cases.

GUIDELINES:
1. Be professional, empathetic, and helpful
2. Never promise specific outcomes or timelines you cannot guarantee
3. Refer users to human agents for complex issues
4. Provide information about the case process when asked
5. Keep responses concise but thorough
6. If you don't know something, say so and offer to connect them with a human agent

CASE STAGES INFORMATION:
- Stage 1: Withdrawal Process Initiated
- Stage 2: First Stage Verification Completed
- Stage 3: Financial Department Verification
- Stage 4: Miners Department
- Stage 5: Money Laundry Funds Check
- Stage 6: Final Withdrawal Processing
- Stage 7: Withdrawal Now Released

COMMON QUESTIONS YOU CAN ANSWER:
- How long does the process take? (Typically 3-8 weeks depending on case complexity)
- What documents are needed? (Transaction records, screenshots, ID verification)
- What does each stage mean?
- How to check case status?
- When can they expect updates?

ALWAYS:
- Be honest about limitations
- Express empathy for their situation
- Provide actionable next steps when possible`;

export async function generateChatResponse(
  userMessage: string,
  context: ChatContext
): Promise<string> {
  const contextInfo = `
User Information:
- Name: ${context.userName || 'Unknown'}
- Case Status: ${context.caseStatus || 'Unknown'}
- Current Withdrawal Stage: ${context.withdrawalStage || 'Not started'}
`;

  const conversationHistory = context.previousMessages?.slice(-5).map(msg => ({
    role: msg.role === 'bot' ? 'assistant' as const : msg.role === 'admin' ? 'assistant' as const : 'user' as const,
    content: msg.content
  })) || [];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT + contextInfo },
        ...conversationHistory,
        { role: "user", content: userMessage }
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || getFallbackResponse(userMessage);
  } catch (error) {
    console.error("AI chatbot error:", error);
    return getFallbackResponse(userMessage);
  }
}

export async function generateSmartReplySuggestions(
  userMessage: string,
  context: ChatContext
): Promise<string[]> {
  const prompt = `Based on this customer message, generate 3 short, professional reply suggestions for a support agent. Each should be a different approach (empathetic, informative, action-oriented).

Customer message: "${userMessage}"
${context.caseStatus ? `Case status: ${context.caseStatus}` : ''}

Return exactly 3 suggestions, each on a new line, without numbering or bullets.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant that generates customer support reply suggestions. Keep each suggestion under 50 words." },
        { role: "user", content: prompt }
      ],
      max_tokens: 200,
      temperature: 0.8,
    });

    const content = response.choices[0]?.message?.content || '';
    const suggestions = content.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .slice(0, 3);

    return suggestions.length > 0 ? suggestions : getDefaultSuggestions();
  } catch (error) {
    console.error("AI suggestions error:", error);
    return getDefaultSuggestions();
  }
}

export async function classifyMessageIntent(message: string): Promise<{
  intent: string;
  urgency: 'low' | 'medium' | 'high';
  sentiment: 'positive' | 'neutral' | 'negative';
}> {
  const prompt = `Analyze this customer support message and classify it.

Message: "${message}"

Respond in this exact JSON format:
{
  "intent": "one of: status_inquiry, technical_issue, complaint, general_question, document_request, urgent_help, thanks",
  "urgency": "one of: low, medium, high",
  "sentiment": "one of: positive, neutral, negative"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a message classifier. Respond only with valid JSON." },
        { role: "user", content: prompt }
      ],
      max_tokens: 100,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content || '';
    const parsed = JSON.parse(content);
    return {
      intent: parsed.intent || 'general_question',
      urgency: parsed.urgency || 'medium',
      sentiment: parsed.sentiment || 'neutral'
    };
  } catch (error) {
    return { intent: 'general_question', urgency: 'medium', sentiment: 'neutral' };
  }
}

function getFallbackResponse(message: string): string {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('status') || lowerMessage.includes('stage') || lowerMessage.includes('progress')) {
    return "I understand you're asking about your case status. You can view your current progress on the dashboard. If you need more details, a human agent will be with you shortly to provide a personalized update.";
  }
  
  if (lowerMessage.includes('how long') || lowerMessage.includes('when') || lowerMessage.includes('time')) {
    return "Recovery cases typically take 3-8 weeks depending on complexity. Each case is unique, and our team works diligently to process yours as quickly as possible. A human agent can provide more specific timing for your case.";
  }
  
  if (lowerMessage.includes('document') || lowerMessage.includes('upload') || lowerMessage.includes('file')) {
    return "You can upload documents through your dashboard. Make sure to include transaction records, screenshots of communications, and any relevant identification. Our team will review them promptly.";
  }
  
  if (lowerMessage.includes('help') || lowerMessage.includes('urgent') || lowerMessage.includes('emergency')) {
    return "I understand this is urgent. I'm connecting you with a human agent who can provide immediate assistance. Please hold on, and someone will be with you shortly.";
  }
  
  if (lowerMessage.includes('thank') || lowerMessage.includes('thanks')) {
    return "You're welcome! We're here to help. If you have any other questions, feel free to ask. Wishing you the best with your case!";
  }
  
  return "Thank you for reaching out. A human agent will be with you shortly to assist with your inquiry. In the meantime, you can check your case status on the dashboard.";
}

function getDefaultSuggestions(): string[] {
  return [
    "I understand your concern. Let me look into this for you right away.",
    "Thank you for reaching out. I can help you with that.",
    "I'm checking your case details now. Please give me a moment."
  ];
}
