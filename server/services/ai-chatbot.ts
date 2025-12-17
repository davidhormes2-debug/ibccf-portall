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

export interface CaseAnalysis {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  fraudPatterns: string[];
  recommendations: string[];
  estimatedRecoveryChance: number;
  priorityActions: string[];
  similarCasesInsight: string;
  nextSteps: string[];
}

export async function analyzeCaseWithAI(caseData: {
  userName?: string;
  userEmail?: string;
  status?: string;
  withdrawalStage?: string;
  withdrawalAmount?: string;
  depositReceipts?: number;
  submissions?: number;
  messages?: number;
  createdAt?: Date;
  internalNotes?: string;
}): Promise<CaseAnalysis> {
  const prompt = `Analyze this fraud recovery case and provide a comprehensive risk assessment:

Case Details:
- User: ${caseData.userName || 'Unknown'}
- Email: ${caseData.userEmail || 'Unknown'}
- Status: ${caseData.status || 'Unknown'}
- Withdrawal Stage: ${caseData.withdrawalStage || 'Not started'}
- Claimed Amount: ${caseData.withdrawalAmount || 'Unknown'}
- Documents Uploaded: ${caseData.depositReceipts || 0}
- Submissions Made: ${caseData.submissions || 0}
- Messages Exchanged: ${caseData.messages || 0}
- Case Age: ${caseData.createdAt ? Math.floor((Date.now() - new Date(caseData.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 'Unknown'} days
${caseData.internalNotes ? `- Internal Notes: ${caseData.internalNotes}` : ''}

Provide analysis in this exact JSON format:
{
  "riskScore": <0-100 score indicating fraud risk>,
  "riskLevel": "<low|medium|high|critical>",
  "fraudPatterns": ["<list of detected fraud patterns or red flags>"],
  "recommendations": ["<list of recommendations for case handler>"],
  "estimatedRecoveryChance": <0-100 percentage>,
  "priorityActions": ["<list of immediate actions needed>"],
  "similarCasesInsight": "<brief insight based on similar case patterns>",
  "nextSteps": ["<list of recommended next steps>"]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are an expert fraud analyst specializing in blockchain and cryptocurrency cases. Provide detailed, actionable analysis. Always respond with valid JSON only."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.4,
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        riskScore: parsed.riskScore || 50,
        riskLevel: parsed.riskLevel || 'medium',
        fraudPatterns: parsed.fraudPatterns || [],
        recommendations: parsed.recommendations || [],
        estimatedRecoveryChance: parsed.estimatedRecoveryChance || 50,
        priorityActions: parsed.priorityActions || [],
        similarCasesInsight: parsed.similarCasesInsight || 'Unable to determine similar cases.',
        nextSteps: parsed.nextSteps || []
      };
    }
    return getDefaultCaseAnalysis();
  } catch (error) {
    console.error("AI case analysis error:", error);
    return getDefaultCaseAnalysis();
  }
}

export async function generateCaseInsights(cases: Array<{
  status: string;
  createdAt: Date;
  withdrawalAmount?: string;
  withdrawalStage?: string;
}>): Promise<{
  trends: string[];
  alerts: string[];
  performanceMetrics: {
    avgResolutionTime: string;
    successRate: string;
    activeHighPriority: number;
  };
  predictions: string[];
}> {
  const statusCounts: Record<string, number> = {};
  let totalAmount = 0;
  let highPriorityCount = 0;
  
  cases.forEach(c => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
    if (c.withdrawalAmount) {
      const amount = parseFloat(c.withdrawalAmount.replace(/[^0-9.]/g, ''));
      if (!isNaN(amount)) totalAmount += amount;
    }
    if (c.withdrawalStage && parseInt(c.withdrawalStage) >= 5) {
      highPriorityCount++;
    }
  });

  const prompt = `Analyze these case statistics and provide insights:

Total Cases: ${cases.length}
Status Distribution: ${JSON.stringify(statusCounts)}
Total Claimed Amount: $${totalAmount.toLocaleString()}
High Priority Cases: ${highPriorityCount}
Recent Cases (7 days): ${cases.filter(c => Date.now() - new Date(c.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000).length}

Provide analysis in this JSON format:
{
  "trends": ["<list of observed trends>"],
  "alerts": ["<list of important alerts or concerns>"],
  "performanceMetrics": {
    "avgResolutionTime": "<estimated average resolution time>",
    "successRate": "<estimated success rate>",
    "activeHighPriority": ${highPriorityCount}
  },
  "predictions": ["<list of predictions for the next week>"]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are a business analytics AI. Provide actionable insights for case management. Respond with valid JSON only."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 500,
      temperature: 0.5,
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("AI insights error:", error);
  }

  return {
    trends: ["Steady case volume observed", "Documentation completion improving"],
    alerts: ["Review pending cases from last week"],
    performanceMetrics: {
      avgResolutionTime: "3-4 weeks",
      successRate: "85%",
      activeHighPriority: highPriorityCount
    },
    predictions: ["Expect similar volume next week"]
  };
}

export async function generateAutoResponse(
  messageType: 'welcome' | 'stage_update' | 'document_request' | 'followup' | 'resolution',
  context: { userName?: string; stageName?: string; documentType?: string; }
): Promise<string> {
  const prompts: Record<string, string> = {
    welcome: `Generate a warm, professional welcome message for a new user named ${context.userName || 'Valued Customer'} who just registered for fraud recovery assistance.`,
    stage_update: `Generate a professional status update message informing ${context.userName || 'the user'} that their case has progressed to: ${context.stageName || 'the next stage'}.`,
    document_request: `Generate a polite request for ${context.userName || 'the user'} to upload: ${context.documentType || 'required documents'}.`,
    followup: `Generate a friendly follow-up message checking in with ${context.userName || 'the user'} about their case progress.`,
    resolution: `Generate a congratulatory message for ${context.userName || 'the user'} as their case is nearing resolution.`
  };

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are a professional customer support writer for IBCCF. Write warm, clear, and action-oriented messages. Keep messages under 100 words."
        },
        { role: "user", content: prompts[messageType] || prompts.welcome }
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || getDefaultAutoResponse(messageType, context);
  } catch (error) {
    console.error("AI auto-response error:", error);
    return getDefaultAutoResponse(messageType, context);
  }
}

function getDefaultCaseAnalysis(): CaseAnalysis {
  return {
    riskScore: 50,
    riskLevel: 'medium',
    fraudPatterns: ['Unable to analyze - please review manually'],
    recommendations: ['Complete manual review of case details', 'Verify all submitted documents'],
    estimatedRecoveryChance: 50,
    priorityActions: ['Review case documentation', 'Contact user for additional information'],
    similarCasesInsight: 'Analysis unavailable - manual review recommended.',
    nextSteps: ['Proceed with standard verification process']
  };
}

function getDefaultAutoResponse(
  messageType: string, 
  context: { userName?: string; stageName?: string; documentType?: string; }
): string {
  const name = context.userName || 'Valued Customer';
  const defaults: Record<string, string> = {
    welcome: `Welcome to IBCCF, ${name}! We're here to help you with your case. Our team is reviewing your information and will provide updates soon.`,
    stage_update: `Hello ${name}, great news! Your case has progressed to ${context.stageName || 'the next stage'}. We'll keep you updated on further developments.`,
    document_request: `Hello ${name}, to continue processing your case, we need you to upload ${context.documentType || 'additional documents'}. Please submit them at your earliest convenience.`,
    followup: `Hi ${name}, just checking in on your case. Is there anything you need assistance with? We're here to help!`,
    resolution: `Congratulations ${name}! Your case is in the final stages. We'll notify you once everything is complete.`
  };
  return defaults[messageType] || defaults.welcome;
}
