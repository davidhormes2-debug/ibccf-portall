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

const TESTIMONIAL_TEMPLATES = [
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

const QUESTION_TEMPLATES = [
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

const REPLY_TEMPLATES = [
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

function generateAnonymousHandle(): string {
  const adjectives = ['Swift', 'Brave', 'Wise', 'Noble', 'Calm', 'Bold', 'True', 'Fair', 'Kind', 'Strong', 
    'Bright', 'Clear', 'Deep', 'Free', 'Good', 'High', 'Just', 'Pure', 'Safe', 'Warm'];
  const nouns = ['Phoenix', 'Eagle', 'Lion', 'Wolf', 'Bear', 'Hawk', 'Tiger', 'Falcon', 'Panther', 'Dragon',
    'Seeker', 'Guardian', 'Pioneer', 'Voyager', 'Sentinel', 'Ranger', 'Champion', 'Defender', 'Victor', 'Hero'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 9999);
  return `${adj}${noun}${num}`;
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
    let handle = generateAnonymousHandle();
    while (usedHandles.has(handle)) {
      handle = generateAnonymousHandle();
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
  
  const deptIds = Array.from(deptMap.values());
  const threadCount = 50;

  for (let i = 0; i < threadCount; i++) {
    const randomBot = allBots[Math.floor(Math.random() * allBots.length)];
    const randomDeptId = deptIds[Math.floor(Math.random() * deptIds.length)];
    
    // Create thread
    const isTestimonial = Math.random() > 0.4;
    const title = isTestimonial 
      ? `My experience with IBCCF - ${randomBot.displayName}`
      : QUESTION_TEMPLATES[Math.floor(Math.random() * QUESTION_TEMPLATES.length)];
    
    const content = isTestimonial
      ? TESTIMONIAL_TEMPLATES[Math.floor(Math.random() * TESTIMONIAL_TEMPLATES.length)]
      : `${QUESTION_TEMPLATES[Math.floor(Math.random() * QUESTION_TEMPLATES.length)]} Any advice would be appreciated!`;

    const createdAt = getRandomDate(60);

    const [thread] = await db.insert(communityThreads).values({
      departmentId: randomDeptId,
      title,
      content,
      authorType: 'bot',
      authorHandle: randomBot.handle,
      authorBotId: randomBot.id,
      viewCount: String(Math.floor(Math.random() * 500) + 10),
      replyCount: '0',
      lastActivityAt: createdAt,
      createdAt
    }).returning();

    // Add replies
    const replyCount = Math.floor(Math.random() * 8) + 1;
    for (let j = 0; j < replyCount; j++) {
      const replyBot = allBots[Math.floor(Math.random() * allBots.length)];
      const replyContent = REPLY_TEMPLATES[Math.floor(Math.random() * REPLY_TEMPLATES.length)];
      const replyDate = new Date(createdAt);
      replyDate.setHours(replyDate.getHours() + Math.floor(Math.random() * 48) + 1);

      await db.insert(communityPosts).values({
        threadId: thread.id,
        content: replyContent,
        authorType: 'bot',
        authorHandle: replyBot.handle,
        authorBotId: replyBot.id,
        likeCount: String(Math.floor(Math.random() * 20)),
        createdAt: replyDate,
        updatedAt: replyDate
      });
    }

    // Update thread reply count
    await db.update(communityThreads)
      .set({ replyCount: String(replyCount) })
      .where((await import("drizzle-orm")).eq(communityThreads.id, thread.id));
  }

  console.log("Community data seeding completed!");
  return { success: true, botsCreated: allBots.length, threadsCreated: threadCount };
}

// Can be imported and called from routes
