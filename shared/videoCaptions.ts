import { createContext, useContext } from "react";

/**
 * Localised caption strings for the withdrawal tutorial video.
 *
 * The video is a live React/Framer-Motion animation (not a pre-rendered
 * MP4), so "localising the video" means driving every on-screen string from
 * this single, locale-keyed table. The scene components keep their structural
 * data (stage numbers, who-acts colour/icon mapping) in code and read only the
 * human-facing copy from here, so all six locales share one scene structure.
 *
 * Terminology (Phrase Key / Merge Deposit / Time-Stamp Deposit / IRS·AML) is
 * kept consistent with the portal's `stages.json` translations.
 */

export type VideoLocaleCode = "en" | "es" | "fr" | "de" | "pt" | "zh";

export interface PhaseCaptions {
  /** Eyebrow label, e.g. "Phase 1". */
  label: string;
  /** Heading rendered as stacked lines (each becomes its own block). */
  titleLines: string[];
  /** Supporting paragraph under the heading. */
  description: string;
  /** Stage titles in render order; indices map to the scene's stage array. */
  stages: string[];
}

export interface VideoCaptions {
  intro: {
    badge: string;
    titleLines: string[];
    subtitleLines: string[];
  };
  /** Role labels shown on each stage card. */
  roles: {
    user: string;
    admin: string;
    system: string;
    complete: string;
  };
  phase1: PhaseCaptions;
  phase2: PhaseCaptions;
  phase3: PhaseCaptions;
  phase4: PhaseCaptions;
}

const en: VideoCaptions = {
  intro: {
    badge: "IBCCF Portal Guide",
    titleLines: ["The Withdrawal", "Journey Demystified"],
    subtitleLines: [
      "14 stages. 4 key phases.",
      "Understand exactly what happens, when, and who handles it.",
    ],
  },
  roles: {
    user: "Action Required",
    admin: "Compliance Review",
    system: "System Processing",
    complete: "Complete",
  },
  phase1: {
    label: "Phase 1",
    titleLines: ["Deposit &", "Key Generation"],
    description:
      "Your case is opened on the ledger. Our compliance system securely generates your Phrase Key using multi-party computation.",
    stages: [
      "Phrase Key Deposit Received",
      "Generating Secure Phrase Key",
      "Phrase Key Approved",
    ],
  },
  phase2: {
    label: "Phase 2",
    titleLines: ["Initiation &", "Verification"],
    description:
      "You select your release speed. Our compliance team verifies your initial deposit and cross-validates your Phrase Key.",
    stages: [
      "Withdrawal Process Initiated",
      "Initial Deposit Verification",
      "Phrase Key Verification",
      "Merge Deposit Required",
    ],
  },
  phase3: {
    label: "Phase 3",
    titleLines: ["Clearance &", "Compliance"],
    description:
      "Financial review ensures integrity. You submit the required Declaration of Compliance for international tax and AML standards.",
    stages: [
      "Financial Dept Verification",
      "Mining Clearance",
      "Activity Verification",
      "IRS / Int'l AML Check",
    ],
  },
  phase4: {
    label: "Phase 4",
    titleLines: ["Final", "Release"],
    description:
      "Your withdrawal is cleared. A final time-stamp locks your block-window, and the funds are irrevocably released to your wallet.",
    stages: ["Final Processing", "Time-Stamp Deposit", "Successfully Released"],
  },
};

const es: VideoCaptions = {
  intro: {
    badge: "Guía del Portal IBCCF",
    titleLines: ["El proceso de retiro", "explicado al detalle"],
    subtitleLines: [
      "14 etapas. 4 fases clave.",
      "Comprenda exactamente qué ocurre, cuándo y quién lo gestiona.",
    ],
  },
  roles: {
    user: "Acción requerida",
    admin: "Revisión de cumplimiento",
    system: "Procesamiento del sistema",
    complete: "Completado",
  },
  phase1: {
    label: "Fase 1",
    titleLines: ["Depósito y", "generación de clave"],
    description:
      "Su caso se abre en el libro mayor. Nuestro sistema de cumplimiento genera de forma segura su Clave Frase mediante computación multiparte.",
    stages: [
      "Depósito de Clave Frase recibido",
      "Generando Clave Frase segura",
      "Clave Frase aprobada",
    ],
  },
  phase2: {
    label: "Fase 2",
    titleLines: ["Inicio y", "verificación"],
    description:
      "Usted elige la velocidad de liberación. Nuestro equipo de cumplimiento verifica su depósito inicial y valida su Clave Frase.",
    stages: [
      "Proceso de retiro iniciado",
      "Verificación del depósito inicial",
      "Verificación de la Clave Frase",
      "Depósito de fusión requerido",
    ],
  },
  phase3: {
    label: "Fase 3",
    titleLines: ["Habilitación y", "cumplimiento"],
    description:
      "La revisión financiera garantiza la integridad. Usted firma la Declaración de Cumplimiento exigida por las normas fiscales y de prevención de blanqueo internacionales.",
    stages: [
      "Verificación del Dpto. Financiero",
      "Autorización de minería",
      "Verificación de actividad",
      "Verificación IRS / AML int'l",
    ],
  },
  phase4: {
    label: "Fase 4",
    titleLines: ["Liberación", "final"],
    description:
      "Su retiro está habilitado. Una marca de tiempo final bloquea su ventana de bloque y los fondos se liberan de forma irrevocable a su monedero.",
    stages: [
      "Procesamiento final",
      "Depósito de marca de tiempo",
      "Retiro liberado con éxito",
    ],
  },
};

const fr: VideoCaptions = {
  intro: {
    badge: "Guide du portail IBCCF",
    titleLines: ["Le parcours de retrait", "enfin clarifié"],
    subtitleLines: [
      "14 étapes. 4 phases clés.",
      "Comprenez exactement ce qui se passe, quand et qui s'en charge.",
    ],
  },
  roles: {
    user: "Action requise",
    admin: "Examen de conformité",
    system: "Traitement système",
    complete: "Terminé",
  },
  phase1: {
    label: "Phase 1",
    titleLines: ["Dépôt et", "génération de clé"],
    description:
      "Votre dossier est ouvert dans le registre. Notre système de conformité génère votre Phrase Clé en toute sécurité par calcul multipartite.",
    stages: [
      "Dépôt de la Phrase Clé reçu",
      "Génération de la Phrase Clé sécurisée",
      "Phrase Clé approuvée",
    ],
  },
  phase2: {
    label: "Phase 2",
    titleLines: ["Lancement et", "vérification"],
    description:
      "Vous choisissez votre vitesse de libération. Notre équipe de conformité vérifie votre dépôt initial et valide votre Phrase Clé.",
    stages: [
      "Processus de retrait lancé",
      "Vérification du dépôt initial",
      "Vérification de la Phrase Clé",
      "Dépôt de fusion requis",
    ],
  },
  phase3: {
    label: "Phase 3",
    titleLines: ["Validation et", "conformité"],
    description:
      "L'examen financier garantit l'intégrité. Vous signez la Déclaration de conformité requise pour les normes fiscales et anti-blanchiment internationales.",
    stages: [
      "Vérification du service financier",
      "Clearance du minage",
      "Vérification d'activité",
      "Vérification IRS / AML int'l",
    ],
  },
  phase4: {
    label: "Phase 4",
    titleLines: ["Libération", "finale"],
    description:
      "Votre retrait est validé. Un horodatage final verrouille votre fenêtre de bloc et les fonds sont libérés de façon irrévocable vers votre portefeuille.",
    stages: [
      "Traitement final",
      "Dépôt d'horodatage",
      "Retrait libéré avec succès",
    ],
  },
};

const de: VideoCaptions = {
  intro: {
    badge: "IBCCF-Portal-Leitfaden",
    titleLines: ["Der Auszahlungsweg", "verständlich erklärt"],
    subtitleLines: [
      "14 Stufen. 4 zentrale Phasen.",
      "Verstehen Sie genau, was wann passiert und wer es bearbeitet.",
    ],
  },
  roles: {
    user: "Aktion erforderlich",
    admin: "Compliance-Prüfung",
    system: "Systemverarbeitung",
    complete: "Abgeschlossen",
  },
  phase1: {
    label: "Phase 1",
    titleLines: ["Einzahlung &", "Schlüsselerzeugung"],
    description:
      "Ihr Fall wird im Ledger eröffnet. Unser Compliance-System erzeugt Ihren Phrase Key sicher mittels Multi-Party-Computation.",
    stages: [
      "Phrase-Key-Einzahlung erhalten",
      "Sicheren Phrase Key erzeugen",
      "Phrase Key genehmigt",
    ],
  },
  phase2: {
    label: "Phase 2",
    titleLines: ["Einleitung &", "Verifizierung"],
    description:
      "Sie wählen Ihre Freigabegeschwindigkeit. Unser Compliance-Team prüft Ihre Ersteinzahlung und validiert Ihren Phrase Key.",
    stages: [
      "Auszahlungsprozess eingeleitet",
      "Prüfung der Ersteinzahlung",
      "Phrase-Key-Verifizierung",
      "Merge-Einzahlung erforderlich",
    ],
  },
  phase3: {
    label: "Phase 3",
    titleLines: ["Freigabe &", "Compliance"],
    description:
      "Die Finanzprüfung sichert die Integrität. Sie unterzeichnen die erforderliche Compliance-Erklärung für internationale Steuer- und AML-Standards.",
    stages: [
      "Prüfung der Finanzabteilung",
      "Mining-Freigabe",
      "Aktivitätsprüfung",
      "IRS- / Int'l-AML-Prüfung",
    ],
  },
  phase4: {
    label: "Phase 4",
    titleLines: ["Endgültige", "Freigabe"],
    description:
      "Ihre Auszahlung ist freigegeben. Ein finaler Zeitstempel sperrt Ihr Block-Fenster und die Mittel werden unwiderruflich an Ihr Wallet freigegeben.",
    stages: [
      "Endbearbeitung",
      "Zeitstempel-Einzahlung",
      "Erfolgreich freigegeben",
    ],
  },
};

const pt: VideoCaptions = {
  intro: {
    badge: "Guia do Portal IBCCF",
    titleLines: ["A jornada de saque", "descomplicada"],
    subtitleLines: [
      "14 etapas. 4 fases principais.",
      "Entenda exatamente o que acontece, quando e quem cuida disso.",
    ],
  },
  roles: {
    user: "Ação necessária",
    admin: "Revisão de conformidade",
    system: "Processamento do sistema",
    complete: "Concluído",
  },
  phase1: {
    label: "Fase 1",
    titleLines: ["Depósito e", "geração da chave"],
    description:
      "Seu caso é aberto no livro-razão. Nosso sistema de conformidade gera sua Chave Frase com segurança usando computação multipartes.",
    stages: [
      "Depósito da Chave Frase recebido",
      "Gerando Chave Frase segura",
      "Chave Frase aprovada",
    ],
  },
  phase2: {
    label: "Fase 2",
    titleLines: ["Início e", "verificação"],
    description:
      "Você escolhe a velocidade de liberação. Nossa equipe de conformidade verifica seu depósito inicial e valida sua Chave Frase.",
    stages: [
      "Processo de saque iniciado",
      "Verificação do depósito inicial",
      "Verificação da Chave Frase",
      "Depósito de mesclagem necessário",
    ],
  },
  phase3: {
    label: "Fase 3",
    titleLines: ["Liberação e", "conformidade"],
    description:
      "A revisão financeira garante a integridade. Você assina a Declaração de Conformidade exigida pelas normas fiscais e de prevenção à lavagem internacionais.",
    stages: [
      "Verificação do Depto. Financeiro",
      "Liberação de mineração",
      "Verificação de atividade",
      "Verificação IRS / AML int'l",
    ],
  },
  phase4: {
    label: "Fase 4",
    titleLines: ["Liberação", "final"],
    description:
      "Seu saque está liberado. Um carimbo de data/hora final bloqueia sua janela de bloco e os fundos são liberados irrevogavelmente para sua carteira.",
    stages: [
      "Processamento final",
      "Depósito de timestamp",
      "Liberado com sucesso",
    ],
  },
};

const zh: VideoCaptions = {
  intro: {
    badge: "IBCCF 门户指南",
    titleLines: ["提现流程", "全程详解"],
    subtitleLines: [
      "14 个阶段，4 个关键环节。",
      "清晰了解每一步何时发生、由谁处理。",
    ],
  },
  roles: {
    user: "需要操作",
    admin: "合规审查",
    system: "系统处理",
    complete: "已完成",
  },
  phase1: {
    label: "第一阶段",
    titleLines: ["存入与", "密钥生成"],
    description:
      "您的案件已在账本中开立。我们的合规系统通过多方计算安全生成您的短语密钥。",
    stages: ["已收到短语密钥存款", "正在生成安全短语密钥", "短语密钥已批准"],
  },
  phase2: {
    label: "第二阶段",
    titleLines: ["发起与", "验证"],
    description:
      "您选择放款速度。我们的合规团队核验您的初始存款并交叉验证您的短语密钥。",
    stages: ["提现流程已发起", "初始存款验证", "短语密钥验证", "需要合并存款"],
  },
  phase3: {
    label: "第三阶段",
    titleLines: ["放行与", "合规"],
    description:
      "财务审查确保资金完整。您需签署国际税务与反洗钱标准所要求的合规声明。",
    stages: ["财务部门验证", "挖矿清算", "活动验证", "IRS / 国际反洗钱核查"],
  },
  phase4: {
    label: "第四阶段",
    titleLines: ["最终", "放款"],
    description:
      "您的提现已通过。最终时间戳锁定您的区块窗口，资金将不可撤销地放款至您的钱包。",
    stages: ["最终处理", "时间戳存款", "成功释放"],
  },
};

export const VIDEO_CAPTIONS: Record<VideoLocaleCode, VideoCaptions> = {
  en,
  es,
  fr,
  de,
  pt,
  zh,
};

export const DEFAULT_VIDEO_LOCALE: VideoLocaleCode = "en";

/**
 * Resolve any locale string (e.g. "pt-BR", "ZH", undefined) to a supported
 * locale code, stripping region tags and falling back to English. This is the
 * code used to pick the matching narration audio track.
 */
export function resolveVideoLocaleCode(locale?: string | null): VideoLocaleCode {
  const base = (locale ?? DEFAULT_VIDEO_LOCALE)
    .toLowerCase()
    .split("-")[0] as VideoLocaleCode;
  return base in VIDEO_CAPTIONS ? base : DEFAULT_VIDEO_LOCALE;
}

/**
 * Resolve any locale string (e.g. "pt-BR", "ZH", undefined) to a supported
 * caption set, stripping region tags and falling back to English.
 */
export function resolveVideoCaptions(locale?: string | null): VideoCaptions {
  return VIDEO_CAPTIONS[resolveVideoLocaleCode(locale)];
}

/**
 * Scene keys in render order. Indices map 1:1 to `SCENE_DURATIONS` in
 * `VideoTemplate` and to the per-scene narration audio files served from
 * `/withdrawal-video/narration/<locale>/<sceneKey>.mp3`.
 */
export const NARRATION_SCENE_KEYS = [
  "intro",
  "phase1",
  "phase2",
  "phase3",
  "phase4",
] as const;

export type NarrationSceneKey = (typeof NARRATION_SCENE_KEYS)[number];

/**
 * Compose the spoken narration script for each scene from the existing,
 * already-localised caption strings. This keeps the voiceover wording in
 * lockstep with the on-screen copy and is the single source of truth used to
 * (re)generate the per-locale TTS audio tracks.
 */
export function buildNarrationScript(
  captions: VideoCaptions,
): Record<NarrationSceneKey, string> {
  const phaseLine = (phase: PhaseCaptions): string =>
    `${phase.label}. ${phase.titleLines.join(" ")}. ${phase.description}`;

  return {
    intro: `${captions.intro.badge}. ${captions.intro.subtitleLines.join(" ")}`,
    phase1: phaseLine(captions.phase1),
    phase2: phaseLine(captions.phase2),
    phase3: phaseLine(captions.phase3),
    phase4: phaseLine(captions.phase4),
  };
}

/**
 * Scenes read their copy from this context so the active locale is resolved
 * once (in `VideoTemplate`) rather than re-derived per scene.
 */
export const VideoCaptionsContext = createContext<VideoCaptions>(en);

export function useVideoCaptions(): VideoCaptions {
  return useContext(VideoCaptionsContext);
}
