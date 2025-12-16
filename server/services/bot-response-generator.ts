import OpenAI from "openai";
import { db } from "../db";
import { 
  pendingBotResponses, 
  communityPosts, 
  communityThreads,
  botProfiles,
  departments
} from "@shared/schema";
import { eq, and, lte, sql, desc } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function getRandomDelay(): number {
  const minMinutes = 2;
  const maxMinutes = 45;
  const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
  return randomMinutes * 60 * 1000;
}

function getHumanLikeDelay(): Date {
  const delay = getRandomDelay();
  return new Date(Date.now() + delay);
}

async function generateAIResponse(
  threadTitle: string,
  threadContent: string,
  existingPosts: string[],
  triggerContent: string,
  botPersonality?: string
): Promise<string> {
  const systemPrompt = `You are a helpful community member in a financial recovery support forum (IBCCF - International Bureau of Crypto-Currency Fraud). 
You are responding to discussions about fraud recovery, withdrawal processes, and support experiences.

Guidelines:
- Be supportive and empathetic
- Share relevant experiences (can be brief)
- Keep responses concise (2-4 sentences typically)
- Use a natural, conversational tone
- Don't be overly formal or robotic
- Occasionally use common phrases like "I understand", "That's frustrating", "Hope this helps"
- Never give specific financial or legal advice
- Be encouraging about the recovery process
${botPersonality ? `\nYour personality traits: ${botPersonality}` : ''}

Respond naturally as if you're a real community member who has gone through similar experiences.`;

  const conversationContext = existingPosts.length > 0 
    ? `\n\nPrevious replies in this thread:\n${existingPosts.slice(-3).join('\n---\n')}` 
    : '';

  const userPrompt = `Thread Title: "${threadTitle}"
Original Post: "${threadContent}"${conversationContext}

New message to respond to: "${triggerContent}"

Write a brief, natural community response:`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 200,
      temperature: 0.8,
    });

    return response.choices[0]?.message?.content || "Thanks for sharing! I can relate to this experience.";
  } catch (error) {
    console.error("Error generating AI response:", error);
    return "Thanks for sharing your experience. Wishing you the best with your case!";
  }
}

async function getRandomActiveBot() {
  const bots = await db
    .select()
    .from(botProfiles)
    .where(eq(botProfiles.isActive, true))
    .limit(50);
  
  if (bots.length === 0) return null;
  return bots[Math.floor(Math.random() * bots.length)];
}

export async function scheduleResponsesForThread(threadId: number, triggerPostId?: number) {
  try {
    const [thread] = await db
      .select()
      .from(communityThreads)
      .where(eq(communityThreads.id, threadId));

    if (!thread) return;

    const existingPosts = await db
      .select()
      .from(communityPosts)
      .where(eq(communityPosts.threadId, threadId))
      .orderBy(communityPosts.createdAt);

    const postContents = existingPosts.map(p => p.content);
    const triggerContent = triggerPostId 
      ? existingPosts.find(p => p.id === triggerPostId)?.content || thread.content
      : thread.content;

    const numberOfResponses = Math.floor(Math.random() * 3) + 1;

    for (let i = 0; i < numberOfResponses; i++) {
      const bot = await getRandomActiveBot();
      if (!bot) continue;

      const aiContent = await generateAIResponse(
        thread.title,
        thread.content,
        postContents,
        triggerContent,
        bot.personality || undefined
      );

      const scheduledFor = getHumanLikeDelay();
      scheduledFor.setMinutes(scheduledFor.getMinutes() + (i * Math.floor(Math.random() * 15)));

      await db.insert(pendingBotResponses).values({
        threadId,
        triggerPostId: triggerPostId || null,
        botId: bot.id,
        content: aiContent,
        scheduledFor,
        status: 'pending',
      });
    }

    console.log(`Scheduled ${numberOfResponses} bot response(s) for thread ${threadId}`);
  } catch (error) {
    console.error("Error scheduling bot responses:", error);
  }
}

export async function processPendingResponses() {
  try {
    const pendingResponses = await db
      .select()
      .from(pendingBotResponses)
      .where(
        and(
          eq(pendingBotResponses.status, 'pending'),
          lte(pendingBotResponses.scheduledFor, new Date())
        )
      )
      .limit(10);

    for (const response of pendingResponses) {
      const [claimed] = await db
        .update(pendingBotResponses)
        .set({ status: 'processing' })
        .where(
          and(
            eq(pendingBotResponses.id, response.id),
            eq(pendingBotResponses.status, 'pending')
          )
        )
        .returning();
      
      if (!claimed) {
        continue;
      }
      try {
        const [bot] = await db
          .select()
          .from(botProfiles)
          .where(eq(botProfiles.id, response.botId!));

        if (!bot) {
          await db
            .update(pendingBotResponses)
            .set({ status: 'failed', errorMessage: 'Bot not found' })
            .where(eq(pendingBotResponses.id, response.id));
          continue;
        }

        const [thread] = await db
          .select()
          .from(communityThreads)
          .where(eq(communityThreads.id, response.threadId!));

        if (!thread || thread.isLocked) {
          await db
            .update(pendingBotResponses)
            .set({ status: 'cancelled', errorMessage: 'Thread locked or not found' })
            .where(eq(pendingBotResponses.id, response.id));
          continue;
        }

        const [newPost] = await db
          .insert(communityPosts)
          .values({
            threadId: response.threadId!,
            content: response.content,
            authorType: 'bot',
            authorHandle: bot.handle,
            authorBotId: bot.id,
          })
          .returning();

        await db
          .update(communityThreads)
          .set({ 
            replyCount: String(parseInt(thread.replyCount || '0') + 1),
            lastActivityAt: new Date()
          })
          .where(eq(communityThreads.id, response.threadId!));

        await db
          .update(botProfiles)
          .set({ 
            postCount: String(parseInt(bot.postCount || '0') + 1),
            lastPostAt: new Date()
          })
          .where(eq(botProfiles.id, bot.id));

        await db
          .update(pendingBotResponses)
          .set({ 
            status: 'delivered', 
            deliveredAt: new Date(),
            resultPostId: newPost.id
          })
          .where(eq(pendingBotResponses.id, response.id));

        console.log(`Delivered bot response ${response.id} to thread ${response.threadId}`);
      } catch (postError) {
        console.error(`Error delivering response ${response.id}:`, postError);
        await db
          .update(pendingBotResponses)
          .set({ 
            status: 'failed', 
            errorMessage: postError instanceof Error ? postError.message : 'Unknown error'
          })
          .where(eq(pendingBotResponses.id, response.id));
      }
    }
  } catch (error) {
    console.error("Error processing pending responses:", error);
  }
}

let processingInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startBotResponseProcessor() {
  if (processingInterval) {
    clearInterval(processingInterval);
  }
  
  processingInterval = setInterval(async () => {
    if (isProcessing) {
      console.log("Skipping bot response processing - already in progress");
      return;
    }
    
    isProcessing = true;
    try {
      await processPendingResponses();
    } finally {
      isProcessing = false;
    }
  }, 30000);
  
  console.log("Bot response processor started (checking every 30 seconds)");
}

export function stopBotResponseProcessor() {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
    console.log("Bot response processor stopped");
  }
}
