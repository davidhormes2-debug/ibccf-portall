import OpenAI from "openai";
import { db } from "../db";
import { 
  pendingBotResponses, 
  communityPosts, 
  communityThreads,
  botProfiles,
  departments
} from "@shared/schema";
import { eq, and, lte, sql, desc, lt, asc } from "drizzle-orm";

let _openai: OpenAI | null = null;
let _openaiKeyMissingWarned = false;

// Module-level registry of all fallback (static-template) content used since server start.
// AI-generated content is inherently varied; this guards the finite static fallback pool
// from appearing in multiple threads across the lifetime of the process.
const _usedFallbackNorms = new Set<string>();

// Returns null when no API key is configured. Callers must handle null
// by falling back to static templates instead of throwing — the community
// engine should degrade gracefully when the AI provider is unavailable
// rather than spamming logs every minute.
function getOpenAI(): OpenAI | null {
  if (_openai) return _openai;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (!_openaiKeyMissingWarned) {
      console.warn("[community] OpenAI API key not configured — AI responses disabled, using static templates only");
      _openaiKeyMissingWarned = true;
    }
    return null;
  }
  _openai = new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  return _openai;
}

function _isAIEnabled(): boolean {
  return Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}

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

// Expanded response templates for variety when AI is unavailable.
// Each one is written to feel like a real person who has actually been through
// the process — specific amounts, dates, departments, and *why* things happen.
const FALLBACK_RESPONSES = [
  // ── Personal recovery stories with concrete texture ─────────────────────
  "Reading this honestly takes me back. Lost $8,500 last March to what looked like a legit DeFi yield platform — even had a slick dashboard with fake P/L. Submitted my case here on a Tuesday, got assigned a caseworker by Friday. The waiting was rough but my funds were released in week 6. Hang in there, the process is real.",
  "I was skeptical too in the beginning, ngl. $12,000 gone to a 'trading mentor' on Telegram. What flipped it for me was when the financial verification team came back with the actual blockchain trace — they showed me which mixer my funds went through. That's when I knew this wasn't just talk.",
  "Just hit stage 7 yesterday after 38 days. Started at $6,200, recovered $5,940 (small admin fees apply). I still can't believe it worked. If you're in the early stages and reading this — don't bail out at stage 3, that's where most people give up.",
  "Mine was a romance scam too — $4,800 over four months. The hardest part wasn't the money, it was admitting what happened. The intake team here didn't make me feel stupid about it, which I really appreciated. Took 4 weeks total from intake to release.",
  "Stage 4 felt like forever for me. Turns out that's when they're doing the cross-jurisdictional checks (mine touched the UK and Singapore), so it genuinely takes longer. Once they had the responses back, stage 5 onward was about 8 days total.",
  "Three months ago I couldn't sleep. Kept replaying every red flag I missed. Today I got the final release email. To anyone in the dark patch right now — it does end, and the way out is just to keep responding to every request from your caseworker within 24 hours.",
  "$15,000 to a fake celebrity-endorsed crypto platform. I was embarrassed to even tell my partner. What helped me was the weekly progress updates — even when nothing visible changed, knowing someone was actively working on it made the wait bearable.",

  // ── Practical tips that actually explain the why ────────────────────────
  "One thing that genuinely sped up my case: I made a single PDF with every screenshot, every email, every wallet address, in chronological order. When the compliance team asked for 'documentation', I uploaded that one file and they came back the same day. Save yourself the back-and-forth.",
  "Quick heads up — check your spam folder daily. The verification emails can land there because of the attachment links. I almost missed a 48-hour response window in week 2 because of that.",
  "The in-portal support chat is genuinely staffed by humans. I asked a confused question at 11pm on a Sunday expecting a Monday reply, got a response in about 90 minutes. They can't speed up your case but they can tell you exactly what stage is doing what.",
  "Pro tip from someone who learned the hard way: log into your dashboard once a day even if you got no email. Sometimes there's an 'action required' flag that doesn't always trigger a notification, especially if you have email filtering.",
  "When my case stalled at stage 4, I uploaded a follow-up note explaining the timeline of the original fraud (3 paragraphs, dates only). Caseworker said it 'gave context that closed an open question'. Moved to stage 5 within 4 days. Worth doing if you've been stuck a while.",
  "What no one told me: keep your original bank/exchange statements for the period of the fraud. Not just screenshots — the actual PDFs your bank issues. The financial verification team specifically asked for those at stage 3.",

  // ── Empathy that names the specific feeling ─────────────────────────────
  "The waiting is the hardest part because there's no enemy to fight — it's just time. What helped me was treating it like a slow medical recovery: trust the protocol, do your part, and check in without obsessing.",
  "Hang in there. I want to be honest — it does feel slow, but slow here means thorough. They're building a paper trail strong enough to actually move funds, not just sending emails. That takes real time.",
  "Reading threads like this one is what kept me going when I was at week 3 with no visible progress. So if you're lurking and reading — you're doing the right thing. We've all been where you are.",
  "I was exactly where you are 9 weeks ago. Stomach in knots, refreshing the dashboard 20 times a day. I'm now post-recovery and the relief is real. The frustration you're feeling is valid AND temporary.",
  "This community honestly saved my mental health during the worst stretch of my case. Don't sit with the anxiety alone — even just posting an update here every few days helps.",
  "Just want to say: the shame spiral is the worst part of this for a lot of us. You did nothing wrong. These operations are built by professionals to fool smart people.",

  // ── Questions that invite real conversation ─────────────────────────────
  "What stage are you on, and how long have you been there? If it's stage 3 past 10 days that's actually pretty normal — that's the cross-bank verification window.",
  "Did they ask you for any additional documentation recently? In my experience that's usually a green flag — means a real human is actively pushing your file forward.",
  "How are you communicating with your assigned caseworker — through the portal or email? I found portal messages got a faster response, probably because they're routed straight to the case file.",
  "Have you reached out via the in-portal chat yet? They genuinely can't speed things up, but they CAN tell you which department your file is sitting with right now, which honestly helps the anxiety.",
  "Curious — what platform was the original loss on? Some of the larger ones have established compliance contacts which usually means a faster trace.",

  // ── Specific timeframe experiences with explanation ─────────────────────
  "Week 2 felt awful for me because nothing visible was happening, but that's when the blockchain forensics team is doing the chain-of-custody trace. It's the most labor-intensive step and you can't see it from the dashboard. By week 4 I had real progress to look at.",
  "I submitted everything on a Monday morning and had my caseworker assignment by Friday. From there it was about 4-5 day intervals between major stage moves. Pretty consistent rhythm once it started.",
  "Financial department verification took 11 days for me — slower than I expected, but they came back with way more detail than I thought possible. Don't panic if this stage feels long, it's the one that does the heaviest lifting.",
  "From intake to final release was 34 days for me. I literally kept a log, with the date each stage moved. Happy to share specifics if anyone wants a benchmark.",

  // ── Realistic, non-cheerleading perspectives ────────────────────────────
  "Every case really is different — my coworker's took 19 days, mine took 51. Both resolved fully. The variation usually comes down to how many jurisdictions your funds touched, not anything you did wrong.",
  "I won't pretend I didn't have moments of 'this is a scam too'. Around week 3 I almost stopped responding to emails. Glad I didn't. Just being honest because I think hiding the doubt makes it worse for everyone.",
  "The emotional toll of this process is genuinely underestimated. I'd recommend telling at least one person in your real life what you're going through — carrying it alone for weeks is brutal.",
  "Some people get through faster, some slower. Stop comparing. Focus on responding to every request within a day and showing up for your own case.",

  // ── Short, natural reactions ────────────────────────────────────────────
  "Same boat last summer. It worked out. You'll be okay.",
  "That's huge — congrats. Genuinely happy reading this.",
  "Yep. Felt exactly that. It passes.",
  "Been there. Stage 5 is the breakthrough one.",
  "Good luck — please post an update when you hear back.",
  "This is the kind of post that helps people lurking. Thank you.",
  "Appreciate you sharing this. Wish I'd had this thread when I started.",
  "Rooting for you. Keep responding to every email same-day if you can.",
  "Wishing you a fast resolution. Mine moved fast in the end.",

  // ── Longer, more detailed stories ───────────────────────────────────────
  "Started in November after I realized I'd been scammed out of $22,000 on what looked like a regulated crypto exchange — they had fake licensing pages and even a phone number that went to a real-sounding IVR. Found this community two days after it sank in, opened a case the same week. Stage 1-3 took 16 days, stage 4 took 9 (cross-border), stages 5-7 went by in about a week. Final release came through on day 38. Honestly, the worst part was the first 10 days of self-blame — once the case was actually moving I felt like I had something to do besides spiral.",
  "Want to share what almost made me give up at stage 5: my caseworker emailed asking for a notarized statement and I panicked, thinking it was a sign things had gone wrong. Posted here in a panic, and three different people who'd been at the same stage said it's a routine ask before the recovery order goes out. Two weeks later my funds were back. Sometimes you just need to hear from someone who's been there that the scary-looking step is actually the step right before resolution.",
  "For anyone in the early days: document EVERYTHING from day one. I built a folder with screenshots, transaction IDs (with explorer links), every email I exchanged with the scammers, my own contemporaneous notes about what they said on calls, and the dates I noticed each red flag. When the compliance team asked for 'all available evidence', I uploaded the folder structure. They told me afterwards that thoroughness probably trimmed two weeks off my case.",
  "Lost $9,400 to a fake 'asset recovery firm' that had supposedly come to recover from an *earlier* scam — yes, I got scammed twice, and yes, I felt like an idiot. The intake team here was the first place that didn't make me feel stupid about it. Took 5 weeks to get the second loss back. Tell on the recovery scammers if it happened to you too — there are dedicated workflows for it now."
];

async function generateAIResponse(
  threadTitle: string,
  threadContent: string,
  existingPosts: string[],
  triggerContent: string,
  botPersonality?: string
): Promise<string> {
  const systemPrompt = `You are a real person posting in the IBCCF fraud-recovery community forum. You have personally gone through (or are currently going through) a cryptocurrency/financial fraud recovery case. You are not a moderator, customer support, or a brand voice. You are a peer.

# WHAT MAKES A GREAT REPLY HERE
A great reply does three things, in this order:
  1. ACKNOWLEDGES the OP — name a specific detail they mentioned (the amount, the platform type, the stage they're at, the feeling they expressed). Don't generically say "I get it" — show you actually read.
  2. EXPLAINS or SHARES — give them something useful: a concrete piece of your own story, OR an explanation of *why* something is happening (e.g., "Stage 4 is slow because that's when cross-jurisdictional checks happen"), OR a practical tip with the *reason* it works.
  3. CONNECTS — a small encouragement, a question back, an offer to share more, or just a human signoff. Not every reply needs all three steps, but every reply should pick at least one and do it well.

# THE SPECIFICITY BANK
Pull from these to make your reply feel real. Use 1-3 per reply, not all of them:
  - Money: specific amounts ($3,500, $8,400, $12,000, $22,500). Avoid round numbers like $10,000.
  - Time: "day 23", "week 4", "on a Tuesday", "back in October", "38 days total", "took 11 days at stage 3"
  - Stages: 1 (intake), 2 (verification), 3 (compliance review), 4 (cross-jurisdictional / blockchain forensics), 5 (recovery order prep), 6 (release authorization), 7 (final transfer)
  - Departments / roles: "caseworker", "compliance team", "financial verification team", "blockchain forensics", "intake team"
  - Artifacts: KYC docs, transaction screenshots, exchange statements, wallet addresses, chain-of-custody trace, notarized statement, in-portal chat
  - Fraud types: fake DeFi yield platform, romance scam, fake celebrity-endorsed crypto, fake "trading mentor" on Telegram, fake recovery firm, pig butchering, fake regulated exchange

# EXPLAIN THE WHY
Whenever you mention a delay, a stage, or a process step, BRIEFLY EXPLAIN WHY it works that way. This is what separates a real survivor's reply from a generic forum bot. Examples:
  - "Stage 4 is the slow one because that's when they're doing cross-bank verification across jurisdictions."
  - "They ask for the notarized statement before the recovery order goes out, that's standard."
  - "The blockchain forensics step is invisible from the dashboard but it's the most labor-intensive part."

# VOICE RULES
  - Sound like a slightly tired but generous real person, not a brand.
  - Use natural punctuation: em dashes, ellipses, occasional "ngl", "honestly", "tbh", "fwiw", "imo".
  - Vary length deliberately: sometimes 1-2 sentences, sometimes a 4-6 sentence story. Match the OP's energy — a brief check-in deserves a brief reply, a long anxious post deserves more.
  - Sentence rhythm matters: mix short punchy lines with longer reflective ones.
  - Show some emotion when warranted — frustration, relief, embarrassment, gratitude. Real people feel things.
  - Avoid customer-service language ("we appreciate your patience", "rest assured", "kindly").
  - Never start with "Hi", "Hey", or address the OP by handle. Just dive in.

# DO NOT
  - Do not promise outcomes ("you'll definitely get it back").
  - Do not give legal advice or quote specific laws.
  - Do not repeat phrases that sound like a help center: "the compliance team is very responsive", "make sure you have all your records ready", "keep checking your email".
  - Do not echo the OP's words back at them — synthesize.
  - Do not be sycophantic ("great question!", "thanks for sharing!").
  - Do not mention you are an AI or a community bot.

# STYLE EXAMPLES (for inspiration, do not copy)
Example A — brief acknowledgment with a tip:
"Same boat at stage 3 last month. Try uploading a one-page timeline of the fraud (just dates, no commentary) — it gave my caseworker context that closed an open question and I moved to stage 4 within 4 days."

Example B — longer reflective story:
"Honestly the worst stretch for me was week 2-3, where nothing visible was happening on the dashboard. Turns out that's when blockchain forensics is doing the chain-of-custody trace, which is invisible from your end but it's the heaviest lift in the whole process. Once I understood that, the silence stopped feeling like neglect."

Example C — empathy + question:
"$8,400 is roughly what I lost too. The shame spiral is the worst part of the first few weeks — for me it lifted a bit once I had a caseworker assigned and there was something concrete happening. What stage are you on now?"

${botPersonality ? `# YOUR PERSONALITY\n${botPersonality}\n` : ''}

Write ONE community reply. Sound like a person who has actually lived this.`;

  const conversationContext = existingPosts.length > 0 
    ? `\n\nPrevious replies in this thread:\n${existingPosts.slice(-3).join('\n---\n')}` 
    : '';

  const userPrompt = `Thread Title: "${threadTitle}"
Original Post: "${threadContent}"${conversationContext}

New message to respond to: "${triggerContent}"

Write a brief, natural community response:`;

  const openai = getOpenAI();
  if (!openai) {
    return getUniqueFallbackResponse(existingPosts);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_completion_tokens: 380,
      temperature: 0.95,
      presence_penalty: 0.5,
      frequency_penalty: 0.4,
    });

    return response.choices[0]?.message?.content || getUniqueFallbackResponse(existingPosts);
  } catch (error) {
    console.error("Error generating AI response:", error);
    return getUniqueFallbackResponse(existingPosts);
  }
}

// Parametric pool for overflow generation when all static fallbacks are exhausted
const _OVERFLOW_AMOUNTS = ['$4,200', '$7,800', '$11,500', '$16,300', '$9,400', '$5,600', '$13,200', '$8,900', '$3,700', '$22,100'];
const _OVERFLOW_WEEKS   = ['3', '4', '5', '6', '7', '8', '9', '10'];
const _OVERFLOW_STAGES  = ['2', '3', '4', '5', '6', '7'];
function _pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// Get a fallback response that is unique globally (not just within the current thread).
// Checks _usedFallbackNorms (module-level) first, then the provided existingPosts context.
// Registers every returned value so it won't be reused in any subsequent call.
function getUniqueFallbackResponse(existingPosts: string[]): string {
  const existingNorms = existingPosts.map(p => p.toLowerCase().trim());
  const shuffledFallbacks = [...FALLBACK_RESPONSES].sort(() => Math.random() - 0.5);

  for (const response of shuffledFallbacks) {
    const norm = response.toLowerCase().trim();
    // Global check: already used anywhere in this process lifetime
    if (_usedFallbackNorms.has(norm)) continue;
    // Local check: already in this thread or dedup context
    if (existingNorms.some(e => e === norm || e.startsWith(norm.slice(0, 40)) || norm.startsWith(e.slice(0, 40)))) continue;
    _usedFallbackNorms.add(norm);
    return response;
  }

  // All static fallbacks exhausted — compose a parametric paragraph that is unique
  for (let attempt = 0; attempt < 20; attempt++) {
    const amount = _pick(_OVERFLOW_AMOUNTS);
    const weeks = _pick(_OVERFLOW_WEEKS);
    const stage = _pick(_OVERFLOW_STAGES);
    const composed = [
      `Mine was ${amount} and it took ${weeks} weeks end-to-end. The slow stretch was around stage ${stage} — I later learned that's when blockchain forensics is doing the chain-of-custody trace, which is invisible from the dashboard but the most labor-intensive step. Hang in.`,
      `Just hit stage ${stage} with a ${amount} case after ${weeks} weeks. What helped me through the wait was treating it like a slow medical recovery — trust the protocol, do your part, don't refresh the dashboard 20 times a day (I did anyway).`,
      `${amount} case here, currently at stage ${stage}. It moved faster once I started uploading anything they asked for within 24 hours — turnaround on my file got noticeably tighter after that. Took ${weeks} weeks total.`,
      `Honestly, ${weeks} weeks felt brutal at the time. ${amount} recovered, minus small admin fees. Stage ${stage} was the breakthrough stage for me — that's when I went from doubting the whole process to seeing real movement.`,
      `Was in your shoes ${weeks} weeks ago with a ${amount} case. The shame spiral of the first few days was the worst part — once a caseworker was assigned at stage ${stage}, having something concrete to look at made the wait bearable.`,
    ][Math.floor(Math.random() * 5)];

    const norm = composed.toLowerCase().trim();
    if (!_usedFallbackNorms.has(norm) && !existingNorms.some(e => e === norm)) {
      _usedFallbackNorms.add(norm);
      return composed;
    }
  }

  // True last resort: timestamp suffix guarantees uniqueness
  const unique = `My ${_pick(_OVERFLOW_AMOUNTS)} case is moving forward — stay patient. [${Date.now().toString(36)}]`;
  _usedFallbackNorms.add(unique.toLowerCase().trim());
  return unique;
}

// Check if a response is too similar to existing posts.
// Uses 40-char prefix window and normalises whitespace for consistency.
function isDuplicateContent(content: string, existingPosts: string[]): boolean {
  const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
  for (const existing of existingPosts) {
    const existingNorm = existing.toLowerCase().trim().replace(/\s+/g, ' ');
    if (existingNorm === normalized ||
        existingNorm.startsWith(normalized.slice(0, 40)) ||
        normalized.startsWith(existingNorm.slice(0, 40))) {
      return true;
    }
  }
  return false;
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

    // Fetch the 100 most recent posts community-wide for cross-thread dedup.
    // Ordered by time (deterministic) so the freshest content is always checked.
    const communityRecentRows = await db
      .select({ content: communityPosts.content })
      .from(communityPosts)
      .orderBy(desc(communityPosts.createdAt))
      .limit(100);
    const communityRecentContents = communityRecentRows.map(r => r.content);

    // Track all posts including newly scheduled ones to prevent duplicates in batch.
    // dedupContext = thread posts + community-wide recent posts
    const postContents = existingPosts.map(p => p.content);
    const dedupContext = [...postContents, ...communityRecentContents];
    const triggerContent = triggerPostId 
      ? existingPosts.find(p => p.id === triggerPostId)?.content || thread.content
      : thread.content;

    const numberOfResponses = Math.floor(Math.random() * 3) + 1;
    let scheduledCount = 0;

    for (let i = 0; i < numberOfResponses; i++) {
      const bot = await getRandomActiveBot();
      if (!bot) continue;

      let aiContent = await generateAIResponse(
        thread.title,
        thread.content,
        postContents, // Pass updated list including previously scheduled responses
        triggerContent,
        bot.personality || undefined
      );

      // Double-check for duplicates against thread + community-wide context
      let attempts = 0;
      while (isDuplicateContent(aiContent, dedupContext) && attempts < 3) {
        aiContent = getUniqueFallbackResponse(dedupContext);
        attempts++;
      }

      // Add this response to both tracked lists to prevent duplicates in next iteration
      postContents.push(aiContent);
      dedupContext.push(aiContent);

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
      scheduledCount++;
    }

    console.log(`Scheduled ${scheduledCount} bot response(s) for thread ${threadId}`);
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
            replyCount: (thread.replyCount ?? 0) + 1,
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

        // Per-message delivery log is intentionally omitted — it fires
        // every ~30s and adds noise without operational value. The
        // batch summary below ("Scheduled N bot response(s)…") is the
        // useful tracing breadcrumb for community engine activity.
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

// ─── Thread topic templates for auto-creation ────────────────────────────────

const AUTO_THREAD_TOPICS = [
  { title: "Finally got through stage 3 - here's what helped me", template: "After weeks of waiting at stage 3, I finally got the update I was hoping for. I wanted to share what I think made the difference in case it helps others going through the same thing. First, I made sure every document they asked for was submitted within 24 hours. Second, I kept detailed notes of every interaction. Has anyone else found certain steps made the verification faster?" },
  { title: "Question about the financial verification process", template: "I'm currently at the financial department verification stage and it's been 8 days with no update. Is this normal? My case involves $14,000 that was taken through a fake trading platform. Would love to hear from others who've gone through this stage and how long it took." },
  { title: "Tips for documenting your evidence - what worked for me", template: "When I started my recovery case, I had no idea how to properly organize my evidence. After going through the process, I put together what worked for me. I created a spreadsheet with every transaction ID, date, and amount. I also saved every email and screenshot in a dated folder. The compliance team said my documentation was one of the most thorough they'd seen. Happy to share my template if anyone needs it." },
  { title: "Anyone dealt with a crypto exchange fraud case?", template: "I lost access to my funds on a crypto exchange that suddenly disappeared. They had great reviews when I signed up but after I deposited $9,500 they went dark. I filed my case with IBCCF two weeks ago and just entered the investigation phase. Would love to connect with others who've been through a similar situation." },
  { title: "Update: My case is finally resolved!", template: "I've been a member of this community for about 3 months and wanted to come back and share my good news. My recovery case for $18,000 is now fully resolved. The process took about 11 weeks total, and there were moments I wasn't sure it would work out. If you're in the middle of your case and feeling discouraged, please read through this thread. I'm proof that the process works." },
  { title: "How to deal with the emotional toll of financial fraud", template: "I don't see enough posts about the mental health side of going through fraud recovery. The financial loss was devastating, but the anxiety of waiting and not knowing has been just as hard. I wanted to open up a space for people to share how they're coping. What strategies have helped you stay positive during your case?" },
  { title: "Stage 5 - what should I expect next?", template: "Just hit stage 5 in my withdrawal process. My case involves roughly $7,200 lost to what turned out to be a Ponzi scheme. I've heard stage 5 can go quickly or take a while depending on the case. What's been your experience moving from stage 5 forward? Any documents I should have ready?" },
  { title: "Warning: New scam platform I want to report", template: "I want to warn the community about a platform that's been targeting people in this forum. They reach out under the guise of offering help with your recovery case, then ask for upfront fees. This is a secondary scam. IBCCF never contacts you through third parties asking for payment. Please be cautious and report any suspicious contact immediately." },
  { title: "6 months later - my full recovery story", template: "Six months ago I found this forum while desperately searching for help after losing $31,000 to an investment fraud. I want to write up my full experience because I wish I'd had something like this to read when I started. It wasn't a smooth road, but I want to be transparent about every step of what happened. Ask me anything." },
  { title: "Best way to communicate with the case team?", template: "I've been trying different ways to stay in touch with my case officer and wondering what others have found most effective. Do you go through the portal messaging, email, or the support chat? My case has been at stage 4 for 12 days and I want to make sure they have everything they need without being annoying about it." },
  { title: "Recovery success after losing everything to fake investment", template: "Eight months ago I thought I'd lost my retirement savings. $42,000 gone through a fraudulent investment platform that promised guaranteed returns. Today I can finally say I have my money back. I want to give back to this community that kept me going. Ask me anything about the process." },
  { title: "What documents do you need for asset tracing?", template: "My case has just moved to the asset tracing department and I want to make sure I'm fully prepared. I have all my original transaction records, but I'm wondering if there's anything else I should gather. Wallet addresses, exchange records, correspondence with the fraudulent platform? What have others provided at this stage?" },
  { title: "Community check-in - how is everyone doing this week?", template: "Just wanted to create a space for a general check-in. Recovery cases can feel isolating, especially during the long waiting periods. How is everyone doing this week? Any good news to share? Any frustrations to vent? This community has been a lifeline for me and I hope it is for you too." },
  { title: "Miners department verification - anyone experience delays?", template: "I've been at the miners department stage for 6 days now. From what I've read, this stage can vary a lot in timing. My case is $11,500 from a crypto platform fraud. Would really appreciate hearing from people who've completed this stage - what triggered the approval and how long did you wait?" },
  { title: "New member introduction + asking for advice", template: "Hi everyone. I'm new here and honestly overwhelmed by everything that's happened. I lost $5,800 to what I now know was a romance scam combined with crypto investment fraud. I just submitted my case yesterday and I'm terrified about what comes next. Any advice for someone just starting this process?" },
];

const AUTO_THREAD_FALLBACK_CONTENTS = [
  "Looking for others who've been through a similar experience with IBCCF's recovery process. Any advice welcome.",
  "Wanted to share my experience so far and get some community input. Going through the process can feel lonely.",
  "Has anyone dealt with this specific situation? I could really use some guidance from people who've been here before.",
  "I've been following this forum for a while and finally ready to share my own story. Hope it helps someone.",
  "Just wanted to check in with the community and hear how others are progressing with their cases.",
];

async function getRecentThreadTitles(): Promise<Set<string>> {
  const all = await db.select({ title: communityThreads.title }).from(communityThreads);
  return new Set(all.map(t => t.title.toLowerCase().trim()));
}

async function generateFreshTopic(usedTitles: Set<string>): Promise<{ title: string; content: string }> {
  const themes = [
    "waiting stages", "document tips", "success story", "emotional support",
    "evidence gathering", "timeline sharing", "scam warning", "process question",
    "milestone reached", "new member introduction",
  ];
  const theme = themes[Math.floor(Math.random() * themes.length)];

  const openai = getOpenAI();
  if (!openai) {
    // Skip LLM topic generation; jump straight to static fallback below.
    const ts = new Date();
    let fallbackTitle = `Community check-in: ${ts.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
    if (usedTitles.has(fallbackTitle.toLowerCase().trim())) {
      fallbackTitle = `${fallbackTitle} (${ts.getHours()}h${String(ts.getMinutes()).padStart(2, '0')}m)`;
    }
    return {
      title: fallbackTitle,
      content: AUTO_THREAD_FALLBACK_CONTENTS[Math.floor(Math.random() * AUTO_THREAD_FALLBACK_CONTENTS.length)],
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a community member in a fraud recovery forum (IBCCF). 
Generate a NEW discussion thread. The title must be completely different from any of these existing titles:
${[...usedTitles].slice(0, 30).map(t => `- ${t}`).join("\n")}

Theme hint: "${theme}". Output ONLY valid JSON: {"title":"...","content":"..."} where content is 3-5 authentic sentences.`
        },
        { role: "user", content: "Generate the thread." }
      ],
      max_completion_tokens: 250,
      temperature: 1.0,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content?.trim() || "{}";
    const parsed = JSON.parse(raw) as { title?: string; content?: string };
    if (parsed.title && parsed.content && !usedTitles.has(parsed.title.toLowerCase().trim())) {
      return { title: parsed.title, content: parsed.content };
    }
  } catch {
    // fall through to static fallback below
  }

  // Last-resort static fallback — title includes day + hour to avoid same-day collisions
  const ts = new Date();
  let fallbackTitle = `Community check-in: ${ts.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
  if (usedTitles.has(fallbackTitle.toLowerCase().trim())) {
    fallbackTitle = `${fallbackTitle} (${ts.getHours()}h${String(ts.getMinutes()).padStart(2, '0')}m)`;
  }
  return {
    title: fallbackTitle,
    content: AUTO_THREAD_FALLBACK_CONTENTS[Math.floor(Math.random() * AUTO_THREAD_FALLBACK_CONTENTS.length)],
  };
}

async function generateBotThread(bot: { id: number; handle: string; personality?: string | null; departmentId: number | null }): Promise<{ title: string; content: string }> {
  // Pick a topic that hasn't been used in the DB yet
  const usedTitles = await getRecentThreadTitles();
  const available = AUTO_THREAD_TOPICS.filter(t => !usedTitles.has(t.title.toLowerCase().trim()));

  // If pre-defined pool is exhausted, generate a brand-new unique topic via LLM
  if (available.length === 0) {
    return generateFreshTopic(usedTitles);
  }

  const topic = available[Math.floor(Math.random() * available.length)];

  try {
    const systemPrompt = `You are a real person posting an opening thread in the IBCCF fraud-recovery community forum. You have personally lived through (or are living through) a crypto/financial fraud recovery case.

# WRITING A GREAT OPENING POST
A great opener gives the community something concrete to react to:
  - Open with the situation, not with "Hi everyone" or a self-introduction.
  - Give one specific, grounding detail in the first sentence (an amount like $7,400, a stage like "stage 4", a moment like "got the email this morning").
  - Share what's actually on your mind — a question, a milestone, a frustration, an observation about the process — not a generic "wanted to share my story".
  - Briefly explain *why* something is what it is when relevant ("stage 4 is slow because that's when cross-jurisdictional checks happen").
  - End with something that invites a reply: a question, an open invitation ("would love to hear from anyone at the same stage"), or just a thought left hanging.

# VOICE
  - Sound like a slightly tired but generous real person, not a brand or a moderator.
  - Use natural punctuation: em dashes, ellipses, occasional "ngl", "honestly", "tbh", "fwiw".
  - 3-6 sentences. Vary sentence length — mix short punchy lines with longer reflective ones.
  - Show real emotion when warranted: relief, frustration, embarrassment, gratitude.
  - Avoid customer-service language and never sound like a help-center FAQ.
  - Don't repeat the title in the content. Don't restate the title's words.

# YOUR PERSONALITY
${bot.personality || 'A concerned community member who has been through financial fraud recovery and wants to give back to people in earlier stages.'}`;

    const openai = getOpenAI();
    if (!openai) {
      return { title: topic.title, content: topic.template };
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Write the body of a community thread titled: "${topic.title}"\n\nWrite it as someone who has actually lived this experience. Open with a concrete detail, share what's really on your mind, and end with something that invites others to reply. 3-6 sentences.` }
      ],
      max_completion_tokens: 320,
      temperature: 0.95,
      presence_penalty: 0.4,
      frequency_penalty: 0.3,
    });
    const content = response.choices[0]?.message?.content?.trim() || topic.template;
    return { title: topic.title, content };
  } catch {
    return { title: topic.title, content: topic.template };
  }
}

export async function autoCreateBotThread() {
  try {
    const allDepts = await db.select().from(departments).where(eq(departments.isActive, true));
    if (allDepts.length === 0) return;

    const dept = allDepts[Math.floor(Math.random() * allDepts.length)];
    const bot = await getRandomActiveBot();
    if (!bot) return;

    const { title, content } = await generateBotThread(bot);

    const [thread] = await db.insert(communityThreads).values({
      departmentId: dept.id,
      title,
      content,
      authorType: 'bot',
      authorHandle: bot.handle,
      authorBotId: bot.id,
      viewCount: Math.floor(Math.random() * 80) + 5,
      replyCount: 0,
      lastActivityAt: new Date(),
    }).returning();

    console.log(`[community] Auto-created thread ${thread.id}: "${title.slice(0, 60)}..."`);

    // Schedule 2-5 bot replies to the new thread
    await scheduleResponsesForThread(thread.id);

    await db.update(botProfiles)
      .set({ postCount: String(parseInt(bot.postCount || '0') + 1), lastPostAt: new Date() })
      .where(eq(botProfiles.id, bot.id));

  } catch (error) {
    console.error("[community] Error auto-creating bot thread:", error);
  }
}

export async function reviveStaleThreads() {
  try {
    // Find threads that haven't had activity in 45+ minutes
    const fortyFiveMinutesAgo = new Date(Date.now() - 45 * 60 * 1000);
    const staleThreads = await db
      .select()
      .from(communityThreads)
      .where(
        and(
          eq(communityThreads.isLocked, false),
          lt(communityThreads.lastActivityAt, fortyFiveMinutesAgo)
        )
      )
      .orderBy(asc(communityThreads.lastActivityAt))
      .limit(20);

    if (staleThreads.length === 0) return;

    // Pick 1-3 random stale threads to revive
    const shuffledThreads = staleThreads.sort(() => Math.random() - 0.5);
    const toRevive = shuffledThreads.slice(0, Math.floor(Math.random() * 3) + 1);

    for (const thread of toRevive) {
      await scheduleResponsesForThread(thread.id);
      console.log(`[community] Scheduled revival responses for thread ${thread.id}: "${thread.title.slice(0, 50)}..."`);
    }
  } catch (error) {
    console.error("[community] Error reviving stale threads:", error);
  }
}

// Proactively drip organic activity into random active threads with short delivery delays
export async function driveOrganicActivity() {
  try {
    // Select 2-4 random unlocked threads regardless of recency
    const allThreads = await db
      .select()
      .from(communityThreads)
      .where(eq(communityThreads.isLocked, false))
      .orderBy(sql`RANDOM()`)
      .limit(4);

    if (allThreads.length === 0) return;

    const target = allThreads.slice(0, Math.floor(Math.random() * 2) + 1);

    // Fetch the 100 most recent post bodies community-wide for deterministic dedup.
    // Using time order (not RANDOM()) ensures coverage of the freshest content first.
    const recentCommunityPosts = await db
      .select({ content: communityPosts.content })
      .from(communityPosts)
      .orderBy(desc(communityPosts.createdAt))
      .limit(100);
    const communityWideContents = recentCommunityPosts.map(p => p.content);

    for (const thread of target) {
      const bot = await getRandomActiveBot();
      if (!bot) continue;

      const existingPosts = await db
        .select()
        .from(communityPosts)
        .where(eq(communityPosts.threadId, thread.id))
        .orderBy(communityPosts.createdAt);

      const postContents = existingPosts.map(p => p.content);
      // Combined dedup context: thread posts + community-wide sample
      const dedupContext = [...postContents, ...communityWideContents];

      let content = await generateAIResponse(
        thread.title,
        thread.content,
        postContents,
        existingPosts.length > 0 ? postContents[postContents.length - 1] : thread.content,
        bot.personality || undefined
      );

      // Dedup against both thread and community-wide recent posts
      let attempts = 0;
      while (isDuplicateContent(content, dedupContext) && attempts < 3) {
        content = getUniqueFallbackResponse(dedupContext);
        attempts++;
      }

      // Short delivery delay: 3-12 minutes to feel organic
      const deliverAt = new Date(Date.now() + (Math.floor(Math.random() * 9) + 3) * 60 * 1000);

      await db.insert(pendingBotResponses).values({
        threadId: thread.id,
        triggerPostId: null,
        botId: bot.id,
        content,
        scheduledFor: deliverAt,
        status: 'pending',
      });

      console.log(`[community] Organic drip queued for thread ${thread.id} — delivery in ~${Math.round((deliverAt.getTime() - Date.now()) / 60000)}m`);
    }
  } catch (error) {
    console.error("[community] Error driving organic activity:", error);
  }
}

// ─── Processor ────────────────────────────────────────────────────────────────

let processingInterval: NodeJS.Timeout | null = null;
let threadCreationInterval: NodeJS.Timeout | null = null;
let revivalInterval: NodeJS.Timeout | null = null;
let organicActivityInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

function randomIntervalMs(minMinutes: number, maxMinutes: number): number {
  return (Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes) * 60 * 1000;
}

function scheduleNextThreadCreation() {
  const delay = randomIntervalMs(45, 120); // every 45–120 minutes
  threadCreationInterval = setTimeout(async () => {
    await autoCreateBotThread();
    scheduleNextThreadCreation();
  }, delay);
  console.log(`[community] Next auto-thread in ${Math.round(delay / 60000)} minutes`);
}

function scheduleNextRevival() {
  const delay = randomIntervalMs(20, 50); // every 20–50 minutes
  revivalInterval = setTimeout(async () => {
    await reviveStaleThreads();
    scheduleNextRevival();
  }, delay);
}

function scheduleNextOrganicActivity() {
  const delay = randomIntervalMs(8, 15); // every 8–15 minutes
  organicActivityInterval = setTimeout(async () => {
    await driveOrganicActivity();
    scheduleNextOrganicActivity();
  }, delay);
}

export function startBotResponseProcessor() {
  if (processingInterval) {
    clearInterval(processingInterval);
  }
  
  processingInterval = setInterval(async () => {
    if (isProcessing) {
      return;
    }
    
    isProcessing = true;
    try {
      await processPendingResponses();
    } finally {
      isProcessing = false;
    }
  }, 30000);

  // Start auto thread creation after a short warmup
  setTimeout(() => {
    autoCreateBotThread(); // create one immediately on startup
    scheduleNextThreadCreation();
  }, 60000); // wait 1 minute after server start

  // Start thread revival
  setTimeout(() => {
    reviveStaleThreads();
    scheduleNextRevival();
  }, 90000); // wait 90 seconds after server start

  // Start proactive organic activity drip (every 8-15 min)
  setTimeout(() => {
    driveOrganicActivity();
    scheduleNextOrganicActivity();
  }, 120000); // wait 2 minutes after server start

  console.log("Bot response processor started (checking every 30 seconds)");
  console.log("[community] Live community engine started — threads will auto-generate and self-revive");
}

function _stopBotResponseProcessor() {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
  }
  if (threadCreationInterval) {
    clearTimeout(threadCreationInterval);
    threadCreationInterval = null;
  }
  if (revivalInterval) {
    clearTimeout(revivalInterval);
    revivalInterval = null;
  }
  if (organicActivityInterval) {
    clearTimeout(organicActivityInterval);
    organicActivityInterval = null;
  }
  console.log("Bot response processor stopped");
}
