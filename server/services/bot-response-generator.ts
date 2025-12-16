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

// Expanded response templates for variety when AI is unavailable
const FALLBACK_RESPONSES = [
  // Personal recovery stories with specific details
  "My case involved $8,500 and took about 5 weeks. The verification process felt slow at first, but once I got past stage 3, things moved quickly.",
  "I was skeptical at first too, honestly. Lost $12,000 to a fake trading platform. But I got my funds back after going through all the stages. Patience is key.",
  "Just got my confirmation yesterday! $6,200 recovered after 6 weeks. Don't give up - the process works.",
  "My situation was similar - lost funds to a romance scam. Took 4 weeks but the team was really thorough with the investigation.",
  "I remember being at stage 4 for what felt like forever. But then stages 5-7 went by super fast. Currently waiting for final release.",
  "Three months ago I was in your shoes, stressed and uncertain. Now I'm on the other side. It does get better!",
  "The $15,000 I lost nearly broke me. This community kept me going during the recovery process. You're not alone.",
  
  // Practical tips and advice
  "One thing that helped me - keep ALL your transaction records organized. Screenshots, emails, everything. Made the verification much smoother.",
  "Make sure to check your spam folder! I almost missed an important email from the compliance team.",
  "The support chat is actually really helpful. I had a question about stage 3 and they responded within a few hours.",
  "Pro tip: Log in and check your dashboard at least once a day. Sometimes there are action items that need your attention.",
  "When I hit a snag during verification, I uploaded additional documents proactively. Seemed to speed things up.",
  "I found keeping a written timeline of all my communications really helped me stay organized through this.",
  
  // Encouragement and empathy
  "I know the waiting is the hardest part. But every day you're one step closer to resolution.",
  "Hang in there! The process can feel slow but it's thorough for a reason - they're building your case.",
  "Reading threads like this really helped me when I was going through it. We're all rooting for you.",
  "The frustration is so valid. I was exactly where you are 2 months ago. Now I'm in the final stages.",
  "This community saved my sanity during my case. Don't hesitate to ask questions here.",
  "Sending positive vibes your way. I know how stressful this situation is.",
  
  // Questions and engagement
  "What stage are you at currently? I might be able to share what to expect based on my experience.",
  "Did they ask you for additional documentation? That's usually a good sign they're actively working on it.",
  "How long have you been waiting? Sometimes it helps to know the typical timelines.",
  "Have you tried reaching out through the support chat? They were really responsive when I had questions.",
  
  // Specific timeframe experiences
  "Week 2 was rough for me too. But by week 4, I could see real progress in my dashboard.",
  "I submitted everything on a Monday and heard back by Friday. Their team seems to work pretty efficiently.",
  "The financial department verification took about 10 days for me. After that, things accelerated.",
  "From submission to completion was exactly 34 days for me. I kept a log!",
  
  // Cautious/realistic perspectives
  "Every case is different, so try not to compare too much. My friend's took 3 weeks, mine took 7. Both resolved successfully.",
  "I won't lie - there were moments I doubted. But staying patient and following the process paid off.",
  "The emotional toll of this is real. Make sure you're taking care of yourself during the wait.",
  "I've seen some people get through faster, others slower. Just focus on your own case and keep communication open.",
  
  // Short, natural responses
  "Same here! Best of luck with yours.",
  "That's great news! Happy for you.",
  "Totally understand that feeling.",
  "Been there. It gets easier.",
  "Good luck! Keep us posted.",
  "This is encouraging to hear!",
  "Thanks for sharing your experience.",
  "Fingers crossed for you!",
  "Wishing you a speedy resolution!",
  
  // Longer, detailed experiences
  "My journey started last November when I realized I'd been scammed out of $22,000 on what looked like a legitimate crypto exchange. I was devastated. Found this community, started the recovery process, and just last week received confirmation that my funds are being released. It's been emotional but worth every step.",
  "I want to share something that might help - during stage 5 I got really anxious and almost gave up. Then I saw a post here from someone who went through the same thing. They said to just trust the process. I did, and now I'm at stage 7. Sometimes you just need to hear it from someone who's been there.",
  "For anyone in the early stages - document EVERYTHING. I created a folder with all screenshots, transaction IDs, communication logs, everything. When the compliance team asked for additional info, I had it ready within minutes. Pretty sure that helped speed up my case."
];

async function generateAIResponse(
  threadTitle: string,
  threadContent: string,
  existingPosts: string[],
  triggerContent: string,
  botPersonality?: string
): Promise<string> {
  const systemPrompt = `You are a real person in a fraud recovery support community (IBCCF). You've personally gone through a cryptocurrency/financial fraud recovery case.

CRITICAL RULES FOR AUTHENTICITY:
1. Include specific details that make your response unique:
   - Mention specific dollar amounts you dealt with ($3,500, $18,000, etc.)
   - Reference specific timeframes ("took me 6 weeks", "on day 23", "back in October")
   - Mention specific stages or steps you experienced
   
2. Vary your response style randomly:
   - Sometimes be brief (1-2 sentences)
   - Sometimes share a longer story (3-5 sentences)
   - Sometimes ask a question back
   - Sometimes just offer encouragement
   
3. Use natural, imperfect language:
   - Occasional casual phrases ("honestly", "tbh", "ngl")
   - Minor conversational starters ("So", "Yeah", "Actually")
   - Natural enthusiasm ("!", "that's great!", "finally!")
   
4. NEVER repeat these generic phrases:
   - "The compliance team is very responsive to inquiries"
   - "I just completed my case - hang in there"
   - "Keep checking your email for updates"
   - "Make sure you have all your transaction records ready"
   
5. Make each response feel genuinely different - as if written by a unique person with their own story.

${botPersonality ? `Your personality: ${botPersonality}` : ''}

Write ONE natural community response. Be genuine, not robotic.`;

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
      max_tokens: 250,
      temperature: 0.9,
    });

    return response.choices[0]?.message?.content || getUniqueFallbackResponse(existingPosts);
  } catch (error) {
    console.error("Error generating AI response:", error);
    return getUniqueFallbackResponse(existingPosts);
  }
}

// Get a fallback response that hasn't been used in this thread
function getUniqueFallbackResponse(existingPosts: string[]): string {
  const existingList = existingPosts.map(p => p.toLowerCase().trim());
  
  // Shuffle the fallback responses
  const shuffled = [...FALLBACK_RESPONSES].sort(() => Math.random() - 0.5);
  
  // Find one that hasn't been used
  for (const response of shuffled) {
    const normalized = response.toLowerCase().trim();
    let isDuplicate = false;
    
    // Check if any existing post is too similar
    for (let i = 0; i < existingList.length; i++) {
      const existing = existingList[i];
      if (existing.includes(normalized.slice(0, 50)) || normalized.includes(existing.slice(0, 50))) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      return response;
    }
  }
  
  // If all are used, return a random one with slight modification
  const randomResponse = FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
  const prefixes = ["Actually, ", "Yeah, ", "So true - ", "Agree! ", "This - ", "Honestly, "];
  return prefixes[Math.floor(Math.random() * prefixes.length)] + randomResponse.toLowerCase();
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
