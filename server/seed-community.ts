import { db } from "./db";
import { departments, departmentStages, botProfiles, communityThreads, communityPosts, userBadges } from "@shared/schema";

const DEPARTMENT_DATA = [
  {
    key: 'submission',
    name: 'Case Submission',
    description: 'Submit your case for review by our expert team',
    icon: 'FileText',
    color: '#004182',
    displayOrder: '1'
  },
  {
    key: 'request',
    name: 'Request Processing',
    description: 'Track and manage your recovery requests',
    icon: 'ClipboardList',
    color: '#2563eb',
    displayOrder: '2'
  },
  {
    key: 'complaint',
    name: 'Complaint Resolution',
    description: 'File and resolve complaints against fraudulent entities',
    icon: 'AlertTriangle',
    color: '#dc2626',
    displayOrder: '3'
  },
  {
    key: 'compliance',
    name: 'Compliance & Verification',
    description: 'Verify compliance with regulatory requirements',
    icon: 'Shield',
    color: '#059669',
    displayOrder: '4'
  },
  {
    key: 'recovery',
    name: 'Asset Recovery',
    description: 'Recover your assets through our specialized process',
    icon: 'Wallet',
    color: '#7c3aed',
    displayOrder: '5'
  }
];

const STAGE_DATA: Record<string, Array<{ name: string; description: string; stageOrder: string; slaDays: string }>> = {
  submission: [
    { name: 'Initial Review', description: 'Case submitted for initial review', stageOrder: '1', slaDays: '2' },
    { name: 'Documentation Check', description: 'Verifying submitted documents', stageOrder: '2', slaDays: '3' },
    { name: 'Case Assignment', description: 'Assigning to specialist team', stageOrder: '3', slaDays: '1' },
    { name: 'Under Investigation', description: 'Active investigation in progress', stageOrder: '4', slaDays: '7' },
    { name: 'Completed', description: 'Case submission completed', stageOrder: '5', slaDays: '0' }
  ],
  request: [
    { name: 'Request Received', description: 'Request logged in system', stageOrder: '1', slaDays: '1' },
    { name: 'Validation', description: 'Validating request details', stageOrder: '2', slaDays: '2' },
    { name: 'Processing', description: 'Request being processed', stageOrder: '3', slaDays: '5' },
    { name: 'Approval Pending', description: 'Awaiting final approval', stageOrder: '4', slaDays: '3' },
    { name: 'Fulfilled', description: 'Request fulfilled', stageOrder: '5', slaDays: '0' }
  ],
  complaint: [
    { name: 'Complaint Filed', description: 'Complaint officially filed', stageOrder: '1', slaDays: '1' },
    { name: 'Evidence Collection', description: 'Gathering supporting evidence', stageOrder: '2', slaDays: '5' },
    { name: 'Investigation', description: 'Investigating complaint details', stageOrder: '3', slaDays: '10' },
    { name: 'Resolution Proposed', description: 'Resolution being formulated', stageOrder: '4', slaDays: '5' },
    { name: 'Resolved', description: 'Complaint resolved', stageOrder: '5', slaDays: '0' }
  ],
  compliance: [
    { name: 'Compliance Check Initiated', description: 'Starting compliance verification', stageOrder: '1', slaDays: '1' },
    { name: 'Document Verification', description: 'Verifying compliance documents', stageOrder: '2', slaDays: '3' },
    { name: 'Regulatory Review', description: 'Under regulatory review', stageOrder: '3', slaDays: '7' },
    { name: 'Certification', description: 'Issuing compliance certification', stageOrder: '4', slaDays: '2' },
    { name: 'Certified', description: 'Compliance certified', stageOrder: '5', slaDays: '0' }
  ],
  recovery: [
    { name: 'Recovery Case Opened', description: 'Asset recovery case initiated', stageOrder: '1', slaDays: '1' },
    { name: 'Asset Tracing', description: 'Tracing asset movement', stageOrder: '2', slaDays: '10' },
    { name: 'Legal Review', description: 'Legal team reviewing options', stageOrder: '3', slaDays: '7' },
    { name: 'Recovery Action', description: 'Active recovery in progress', stageOrder: '4', slaDays: '14' },
    { name: 'Assets Recovered', description: 'Assets successfully recovered', stageOrder: '5', slaDays: '0' }
  ]
};

const FIRST_NAMES = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth',
  'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen',
  'Christopher', 'Nancy', 'Daniel', 'Lisa', 'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra',
  'Donald', 'Ashley', 'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
  'Kenneth', 'Dorothy', 'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa', 'Timothy', 'Deborah',
  'Ronald', 'Stephanie', 'Edward', 'Rebecca', 'Jason', 'Sharon', 'Jeffrey', 'Laura', 'Ryan', 'Cynthia',
  'Wei', 'Ming', 'Yuki', 'Kenji', 'Priya', 'Raj', 'Mohammed', 'Fatima', 'Carlos', 'Maria',
  'Pedro', 'Ana', 'Hans', 'Greta', 'Pierre', 'Sophie', 'Ivan', 'Olga', 'Ahmed', 'Layla',
  'Chen', 'Li', 'Kim', 'Park', 'Singh', 'Patel', 'Kumar', 'Ali', 'Hassan', 'Omar'
];

const LAST_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const BADGE_LEVELS = ['newcomer', 'member', 'trusted', 'veteran'];

const _TESTIMONIAL_TEMPLATES = [
  "After months of frustration, the IBCCF team helped me recover my funds. Forever grateful!",
  "Professional service from start to finish. They kept me informed every step of the way.",
  "I was skeptical at first, but the results speak for themselves. Highly recommend!",
  "The compliance team was thorough and helped me understand every step of the process.",
  "Fast response times and genuine concern for my case. Thank you IBCCF!",
  "My case was complex but they handled it with expertise. Couldn't ask for better support.",
  "The recovery process was smoother than I expected. Great communication throughout.",
  "Finally found a trustworthy organization to help with my case. Very impressed!",
  "They walked me through everything and never made me feel rushed. Excellent service!",
  "After being scammed, I thought all hope was lost. IBCCF proved me wrong.",
  "The submission process was straightforward and the team was very responsive.",
  "I appreciate how transparent they are about the process and timeline expectations.",
  "My complaint was taken seriously and resolved efficiently. Thank you!",
  "The asset tracing team did an incredible job tracking down my lost funds.",
  "Professional, dedicated, and results-driven. That's my experience with IBCCF.",
  "They helped me navigate complex compliance requirements with ease.",
  "Quick to respond and always available to answer my questions.",
  "I've recommended IBCCF to several friends who were also scammed. Top notch service!",
  "The verification process gave me confidence that my case was in good hands.",
  "From filing to resolution, the complaint process was handled professionally."
];

const _QUESTION_TEMPLATES = [
  "How long does the typical recovery process take?",
  "What documents do I need to submit for my case?",
  "Has anyone dealt with a similar platform scam?",
  "Looking for advice on the compliance verification process.",
  "What should I expect during the investigation phase?",
  "Tips for gathering evidence for my complaint?",
  "Anyone else waiting on stage 3 approval?",
  "How do I track my case progress?",
  "Need help understanding the asset tracing process.",
  "What's the best way to document fraudulent transactions?"
];

const _REPLY_TEMPLATES = [
  "I had a similar experience. Stay patient, the team is thorough.",
  "Mine took about 3 weeks from submission to completion.",
  "Make sure you have all your transaction records ready.",
  "The support chat is really helpful for quick questions.",
  "I just completed my case - hang in there!",
  "Keep checking your email for updates from the team.",
  "The documentation process is crucial. Be thorough!",
  "Welcome to the community! You're in good hands here.",
  "I recommend checking the FAQ section for common questions.",
  "The compliance team is very responsive to inquiries."
];

const PREMIUM_HANDLE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePremiumHandle(): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += PREMIUM_HANDLE_CHARS[Math.floor(Math.random() * PREMIUM_HANDLE_CHARS.length)];
  }
  return `Member #${code}`;
}

function getRandomDate(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysAgo));
  date.setHours(Math.floor(Math.random() * 24));
  date.setMinutes(Math.floor(Math.random() * 60));
  return date;
}

export async function seedCommunityData() {
  console.log("Starting community data seed...");

  // Seed departments
  console.log("Seeding departments...");
  const insertedDepts: Array<{ id: number; key: string }> = [];
  for (const dept of DEPARTMENT_DATA) {
    const [inserted] = await db.insert(departments).values(dept).onConflictDoNothing().returning();
    if (inserted) {
      insertedDepts.push({ id: inserted.id, key: inserted.key });
    }
  }

  // Get all departments (in case some already existed)
  const allDepts = await db.select().from(departments);
  const deptMap = new Map(allDepts.map(d => [d.key, d.id]));

  // Seed stages for each department
  console.log("Seeding department stages...");
  for (const [deptKey, stages] of Object.entries(STAGE_DATA)) {
    const deptId = deptMap.get(deptKey);
    if (deptId) {
      for (const stage of stages) {
        await db.insert(departmentStages).values({
          departmentId: deptId,
          ...stage
        }).onConflictDoNothing();
      }
    }
  }

  // Seed badges
  console.log("Seeding user badges...");
  const badgeData = [
    { name: 'Newcomer', description: 'Just joined the community', icon: '🌱', color: '#10b981', displayOrder: '1' },
    { name: 'Active Member', description: 'Made 10+ posts', icon: '⭐', color: '#3b82f6', displayOrder: '2' },
    { name: 'Trusted Member', description: 'Active for 30+ days', icon: '🛡️', color: '#8b5cf6', displayOrder: '3' },
    { name: 'Veteran', description: 'Successfully resolved case', icon: '🏆', color: '#f59e0b', displayOrder: '4' },
    { name: 'Helper', description: 'Helped 5+ community members', icon: '🤝', color: '#ef4444', displayOrder: '5' },
    { name: 'Success Story', description: 'Shared recovery success', icon: '✨', color: '#06b6d4', displayOrder: '6' }
  ];
  for (const badge of badgeData) {
    await db.insert(userBadges).values(badge).onConflictDoNothing();
  }

  // Generate 600+ bot profiles
  console.log("Generating 650 bot profiles...");
  const usedHandles = new Set<string>();
  const botData: Array<{
    handle: string;
    displayName: string;
    avatarInitials: string;
    departmentId: number;
    caseStage: string;
    badgeLevel: string;
    postCount: string;
    reputation: string;
    joinedDate: Date;
    lastPostAt: Date;
  }> = [];

  for (let i = 0; i < 650; i++) {
    let handle = generatePremiumHandle();
    while (usedHandles.has(handle)) {
      handle = generatePremiumHandle();
    }
    usedHandles.add(handle);

    const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const lastInitial = LAST_INITIALS[Math.floor(Math.random() * LAST_INITIALS.length)];
    const displayName = `${firstName} ${lastInitial}.`;
    const avatarInitials = `${firstName[0]}${lastInitial}`;
    
    const deptKeys = Array.from(deptMap.keys());
    const randomDeptKey = deptKeys[Math.floor(Math.random() * deptKeys.length)];
    const departmentId = deptMap.get(randomDeptKey)!;
    
    const caseStages = ['submitted', 'in_progress', 'under_review', 'completed', 'active'];
    const caseStage = caseStages[Math.floor(Math.random() * caseStages.length)];
    const badgeLevel = BADGE_LEVELS[Math.floor(Math.random() * BADGE_LEVELS.length)];
    const postCount = String(Math.floor(Math.random() * 50));
    const reputation = String(Math.floor(Math.random() * 500));
    const joinedDate = getRandomDate(365);
    const lastPostAt = getRandomDate(30);

    botData.push({
      handle,
      displayName,
      avatarInitials,
      departmentId,
      caseStage,
      badgeLevel,
      postCount,
      reputation,
      joinedDate,
      lastPostAt
    });
  }

  // Insert bots in batches
  const batchSize = 50;
  for (let i = 0; i < botData.length; i += batchSize) {
    const batch = botData.slice(i, i + batchSize);
    await db.insert(botProfiles).values(batch).onConflictDoNothing();
  }

  // Get all bot profiles
  const allBots = await db.select().from(botProfiles);
  console.log(`Created ${allBots.length} bot profiles`);

  // Create community threads and posts
  console.log("Creating community threads and posts...");

  // Build shuffled non-repeating pools for deduplication
  function shuffled<T>(arr: T[]): T[] {
    return [...arr].sort(() => Math.random() - 0.5);
  }

  const THREAD_TEMPLATES = [
    { title: "Finally got through stage 3 — here's what helped me", content: "After weeks of waiting at stage 3, I finally got the update I was hoping for. I wanted to share what I think made the difference in case it helps others going through the same thing. First, I made sure every document they asked for was submitted within 24 hours. Second, I kept detailed notes of every interaction. Has anyone else found certain steps made the verification faster?" },
    { title: "Question about the financial verification process", content: "I'm currently at the financial department verification stage and it's been 8 days with no update. Is this normal? My case involves $14,000 taken through a fake trading platform. Would love to hear from others who've gone through this stage and how long it took." },
    { title: "Tips for documenting your evidence — what worked for me", content: "When I started my recovery case, I had no idea how to properly organize my evidence. After going through the process, I put together what worked. I created a spreadsheet with every transaction ID, date, and amount. The compliance team said my documentation was one of the most thorough they'd seen. Happy to share my template if anyone needs it." },
    { title: "Anyone dealt with a crypto exchange fraud case?", content: "I lost access to my funds on a crypto exchange that suddenly disappeared. They had great reviews when I signed up but after I deposited $9,500 they went dark. I filed my case with IBCCF two weeks ago and just entered the investigation phase. Would love to connect with others who've been through something similar." },
    { title: "Update: My case is finally resolved!", content: "I've been a member of this community for about 3 months and wanted to come back and share my good news. My recovery case for $18,000 is now fully resolved. The process took about 11 weeks total, and there were moments I wasn't sure it would work out. If you're feeling discouraged, please read through this thread." },
    { title: "How to deal with the emotional toll of financial fraud", content: "I don't see enough posts about the mental health side of going through fraud recovery. The financial loss was devastating, but the anxiety of waiting and not knowing has been just as hard. I wanted to open up a space for people to share how they're coping. What strategies have helped you stay positive during your case?" },
    { title: "Stage 5 — what should I expect next?", content: "Just hit stage 5 in my withdrawal process. My case involves roughly $7,200 lost to what turned out to be a Ponzi scheme. I've heard stage 5 can go quickly or take a while depending on the case. What's been your experience moving from stage 5 forward? Any documents I should have ready?" },
    { title: "Warning: New scam platform I want to report", content: "I want to warn the community about a platform that's been targeting people here. They reach out under the guise of offering help with your recovery case, then ask for upfront fees. This is a secondary scam. IBCCF never contacts you through third parties asking for payment. Please be cautious and report any suspicious contact immediately." },
    { title: "6 months later — my full recovery story", content: "Six months ago I found this forum while desperately searching for help after losing $31,000 to an investment fraud. I want to write up my full experience because I wish I'd had something like this to read when I started. It wasn't a smooth road, but I want to be transparent about every step of what happened. Ask me anything." },
    { title: "Best way to communicate with the case team?", content: "I've been trying different ways to stay in touch with my case officer and wondering what others have found most effective. Do you go through the portal messaging, email, or the support chat? My case has been at stage 4 for 12 days and I want to make sure they have everything they need without being too pushy about it." },
    { title: "Recovery success after losing everything to fake investment", content: "Eight months ago I thought I'd lost my retirement savings. $42,000 gone through a fraudulent investment platform that promised guaranteed returns. Today I can finally say I have my money back. I want to give back to this community that kept me going. Ask me anything about the process." },
    { title: "What documents do you need for asset tracing?", content: "My case has just moved to the asset tracing department and I want to make sure I'm fully prepared. I have all my original transaction records, but I'm wondering if there's anything else I should gather. Wallet addresses, exchange records, correspondence with the fraudulent platform — what have others provided at this stage?" },
    { title: "Community check-in — how is everyone doing this week?", content: "Just wanted to create a space for a general check-in. Recovery cases can feel isolating, especially during the long waiting periods. How is everyone doing this week? Any good news to share? Any frustrations to vent? This community has been a lifeline for me and I hope it is for you too." },
    { title: "Miners department verification — anyone experience delays?", content: "I've been at the miners department stage for 6 days now. From what I've read, this stage can vary a lot in timing. My case is $11,500 from a crypto platform fraud. Would really appreciate hearing from people who've completed this stage — what triggered the approval and how long did you wait?" },
    { title: "New member introduction + asking for advice", content: "Hi everyone. I'm new here and honestly overwhelmed by everything that's happened. I lost $5,800 to what I now know was a romance scam combined with crypto investment fraud. I just submitted my case yesterday and I'm terrified about what comes next. Any advice for someone just starting this process?" },
    { title: "How I kept my sanity during the waiting period", content: "Three months in, I had to find ways to cope. The uncertainty was the hardest part. I want to share what worked for me so others have a better experience during the waiting stages of their case recovery." },
    { title: "Did anyone else get asked for a second round of documentation?", content: "I thought I had everything submitted but the team came back asking for more evidence. Specifically transaction IDs from a secondary platform. Has this happened to others? How long did it add to your timeline?" },
    { title: "From complete loss to resolution — what I wish I knew at the start", content: "Looking back on my 4-month recovery journey, there are so many things I'd tell myself at the beginning. I want to share them here so newer members can avoid some of the stress I went through unnecessarily." },
    { title: "Sharing my timeline: from submission to resolved (8 weeks)", content: "Week 1: submitted everything. Week 2: case assigned. Week 3-4: investigation. Week 5-6: compliance review. Week 7-8: final processing and release. Sharing my timeline in case it helps others gauge what to expect." },
    { title: "Important: beware of fake 'recovery agents' on social media", content: "After posting about my case on another forum, I was immediately flooded with DMs from people claiming to be recovery agents. None of them are affiliated with IBCCF. Always verify through official channels and don't share your case details with anyone who contacts you unsolicited." },
    { title: "The compliance verification stage explained — what actually happens", content: "After going through it, I finally understand what the compliance team is actually doing during verification. I'll break it down step by step based on what I was told and what I experienced. I hope it makes the process less mysterious for those currently waiting." },
    { title: "Celebrating my full recovery — $23,000 returned after 14 weeks", content: "I'm writing this with tears in my eyes. Fourteen weeks ago I filed my case after being scammed out of $23,000. Today I received the final confirmation. I can't thank this community enough for keeping me going through the hard weeks." },
    { title: "Stage 2 stuck — is this normal?", content: "I submitted my case 12 days ago and I've been at stage 2 (documentation check) since day 3. I've uploaded everything they asked for. Is this wait time normal? I'm getting a bit anxious and not sure if I should reach out to the support team." },
    { title: "Organized my evidence using a spreadsheet — here's the template", content: "One of the most helpful things I did was create a master spreadsheet of all my transactions, wallet addresses, and communications. I'm happy to share the format I used if it helps anyone else who's starting the documentation phase." },
    { title: "How honest should I be in my case submission?", content: "I'm putting together my initial case submission and wondering how detailed and honest I need to be. Some of the transactions were made during a period where I wasn't fully aware it was a scam. Does it help or hurt to include those details?" },
  ];

  const REPLY_TEMPLATE_POOL = [
    "I had a similar experience. Stay patient, the team is thorough.",
    "Mine took about 3 weeks from submission to completion. Hang in there.",
    "Make sure you have all your transaction records organized — it really speeds things up.",
    "The support chat is genuinely helpful for quick questions. I'd recommend it.",
    "I just got through this stage last week. You're closer than you think!",
    "Keep an eye on your dashboard for any action items. Easy to miss important prompts.",
    "The documentation process is crucial. The more thorough, the better.",
    "Welcome to the community! You're in good hands here.",
    "I've been through this exact stage. It does move forward — just takes time.",
    "From my experience, the compliance team responds quickly if you send a follow-up.",
    "I lost $14,000 and recovered most of it through this process. Don't give up.",
    "What really helped me was keeping a dated log of every interaction. Highly recommend.",
    "Stage 4 was the longest for me too. Took 9 days. But then it picked up fast.",
    "Totally relate to the anxiety of waiting. The lack of visible progress is the hard part.",
    "I actually asked the support team for a status update at day 10 and they were very helpful.",
    "This community genuinely saved my sanity during the waiting period.",
    "My case involved a romance scam — $19,000. Resolved in 7 weeks. There is hope.",
    "Make sure your spam folder is clear. I almost missed a critical email from compliance.",
    "Has anyone tried submitting wallet transaction hashes as supporting evidence? That worked for me.",
    "I feel you. Week 3 is when I started getting really anxious too. It gets better.",
    "Sending positive energy your way. The process does work — I'm living proof.",
    "I recommend writing down every question you have and bringing it to the support chat in one session.",
    "My case jumped stages really fast once I added more documentation proactively.",
    "The reply times from the compliance team have been solid in my experience.",
    "Final stage done. Total time: 10 weeks. $8,600 case fully resolved.",
  ];

  // ── Pre-load existing DB content to prevent duplicates on re-runs ──────────
  const existingThreadRows = await db.select({ title: communityThreads.title }).from(communityThreads);
  const usedTitles = new Set<string>(existingThreadRows.map(r => r.title));

  const existingPostRows = await db.select({ content: communityPosts.content }).from(communityPosts);
  // Global registry: every post body inserted this run + pre-existing DB content
  const usedPostContents = new Set<string>(existingPostRows.map(r => r.content));

  // ── Mutation helpers for generating unique reply variants ─────────────────
  const VARY_AMOUNTS = ['$3,200', '$4,800', '$5,600', '$6,100', '$7,500', '$8,200', '$9,200', '$11,400', '$12,300', '$14,800', '$16,500', '$18,300', '$21,000', '$25,500', '$31,000'];
  const VARY_WEEKS   = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  const VARY_DAYS    = ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'];
  const VARY_STAGES  = ['2', '3', '4', '5', '6', '7'];
  const pickV = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  function mutateReply(template: string): string {
    // Swap any existing numbers with random alternatives to generate a new variant
    return template
      .replace(/\$[\d,]+/g, () => pickV(VARY_AMOUNTS))
      .replace(/\b(\d+)(?= weeks?)/g, () => pickV(VARY_WEEKS))
      .replace(/\b(\d+)(?= days?)/g, () => pickV(VARY_DAYS))
      .replace(/(?<=stage )\d/gi, () => pickV(VARY_STAGES));
  }

  // Derive a unique reply: try the base template, then mutate if already used.
  // Falls back to a freshly composed one-liner if all mutations collide.
  function uniqueReply(base: string): string {
    if (!usedPostContents.has(base)) {
      usedPostContents.add(base);
      return base;
    }
    for (let attempt = 0; attempt < 15; attempt++) {
      const variant = mutateReply(base);
      if (!usedPostContents.has(variant)) {
        usedPostContents.add(variant);
        return variant;
      }
    }
    // Guaranteed-unique composed fallback (astronomically rare to reach)
    const composed = `${pickV(VARY_AMOUNTS)} case, ${pickV(VARY_WEEKS)} weeks — ${base.split('.')[0].toLowerCase()}.`;
    usedPostContents.add(composed);
    return composed;
  }

  // ── Thread seeding ─────────────────────────────────────────────────────────
  const shuffledTemplates = shuffled(THREAD_TEMPLATES);
  const deptIds = Array.from(deptMap.values());
  // Use a shuffled global iterator so reply templates cycle in varied order
  const shuffledReplyPool = shuffled(REPLY_TEMPLATE_POOL);
  let replyPoolIdx = 0;

  const { eq: eqDrizzle } = await import("drizzle-orm");
  let threadsCreated = 0;

  for (const template of shuffledTemplates) {
    // Skip titles that already exist in DB or were used this run
    if (usedTitles.has(template.title)) continue;
    usedTitles.add(template.title);

    const randomBot = allBots[Math.floor(Math.random() * allBots.length)];
    const randomDeptId = deptIds[Math.floor(Math.random() * deptIds.length)];
    const createdAt = getRandomDate(60);

    const [thread] = await db.insert(communityThreads).values({
      departmentId: randomDeptId,
      title: template.title,
      content: template.content,
      authorType: 'bot',
      authorHandle: randomBot.handle,
      authorBotId: randomBot.id,
      viewCount: Math.floor(Math.random() * 500) + 10,
      replyCount: 0,
      lastActivityAt: createdAt,
      createdAt
    }).returning();
    threadsCreated++;

    // Replies: pull templates in order from the shuffled pool, mutate when needed
    // to guarantee each inserted body is globally unique.
    const replyCount = Math.floor(Math.random() * 8) + 2;

    for (let j = 0; j < replyCount; j++) {
      const baseTemplate = shuffledReplyPool[replyPoolIdx % shuffledReplyPool.length];
      replyPoolIdx++;
      const reply = uniqueReply(baseTemplate);

      const replyBot = allBots[Math.floor(Math.random() * allBots.length)];
      const replyDate = new Date(createdAt);
      replyDate.setHours(replyDate.getHours() + Math.floor(Math.random() * 48) + 1);

      await db.insert(communityPosts).values({
        threadId: thread.id,
        content: reply,
        authorType: 'bot',
        authorHandle: replyBot.handle,
        authorBotId: replyBot.id,
        likeCount: String(Math.floor(Math.random() * 20)),
        createdAt: replyDate,
        updatedAt: replyDate
      });
    }

    await db.update(communityThreads)
      .set({ replyCount })
      .where(eqDrizzle(communityThreads.id, thread.id));
  }

  console.log("Community data seeding completed!");
  return { success: true, botsCreated: allBots.length, threadsCreated };
}

// Can be imported and called from routes
