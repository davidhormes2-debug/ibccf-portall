import { createContext, useContext } from "react";

export type VideoLocaleCode = "en" | "es" | "fr" | "de" | "pt" | "zh";

export interface PhaseCaptions {
  label: string;
  titleLines: string[];
  description: string;
  stages: string[];
}

export interface VideoCaptions {
  intro: {
    badge: string;
    titleLines: string[];
    subtitleLines: string[];
  };
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
    titleLines: ["Your Case", "Workflow Explained"],
    subtitleLines: [
      "10 steps. 4 clear phases.",
      "See what happens next and where each action belongs.",
    ],
  },
  roles: {
    user: "Action Required",
    admin: "Case Review",
    system: "System Processing",
    complete: "Complete",
  },
  phase1: {
    label: "Phase 1",
    titleLines: ["Account &", "Intake"],
    description: "Create the case record, complete the intake questionnaire, and review the required agreement.",
    stages: ["Signup", "Questionnaire", "Agreement"],
  },
  phase2: {
    label: "Phase 2",
    titleLines: ["Secure", "Review"],
    description: "Enter the restricted workspace, complete identity verification, and submit the Declaration of Funds.",
    stages: ["Restricted Portal", "KYC", "Declaration of Funds"],
  },
  phase3: {
    label: "Phase 3",
    titleLines: ["Recovery", "Operations"],
    description: "Link the approved payout method and follow the case through tracking and recovery activity.",
    stages: ["Wallet Linking & Calibration", "Tracking & Recovery"],
  },
  phase4: {
    label: "Phase 4",
    titleLines: ["Final", "Completion"],
    description: "Complete escrow-wallet preparation and the final sequence-recovery step.",
    stages: ["Crypto Escrow Wallet Creation", "Sequence Recovery"],
  },
};

const es: VideoCaptions = {
  intro: {
    badge: "Guía del Portal IBCCF",
    titleLines: ["Flujo de su caso", "explicado"],
    subtitleLines: ["10 pasos. 4 fases claras.", "Vea qué ocurre a continuación y dónde corresponde cada acción."],
  },
  roles: { user: "Acción requerida", admin: "Revisión del caso", system: "Procesamiento del sistema", complete: "Completado" },
  phase1: {
    label: "Fase 1", titleLines: ["Cuenta e", "inicio"],
    description: "Cree el registro del caso, complete el cuestionario inicial y revise el acuerdo requerido.",
    stages: ["Registro", "Cuestionario", "Acuerdo"],
  },
  phase2: {
    label: "Fase 2", titleLines: ["Revisión", "segura"],
    description: "Acceda al espacio restringido, complete la verificación de identidad y presente la Declaración de Fondos.",
    stages: ["Portal restringido", "KYC", "Declaración de Fondos"],
  },
  phase3: {
    label: "Fase 3", titleLines: ["Operaciones de", "recuperación"],
    description: "Vincule el método de pago aprobado y siga las actividades de seguimiento y recuperación.",
    stages: ["Vinculación y calibración de cartera", "Seguimiento y recuperación"],
  },
  phase4: {
    label: "Fase 4", titleLines: ["Finalización", "del caso"],
    description: "Complete la preparación de la cartera de custodia y la recuperación final de secuencia.",
    stages: ["Creación de cartera de custodia cripto", "Recuperación de secuencia"],
  },
};

const fr: VideoCaptions = {
  intro: {
    badge: "Guide du portail IBCCF",
    titleLines: ["Le parcours du dossier", "expliqué"],
    subtitleLines: ["10 étapes. 4 phases claires.", "Voyez la prochaine action et l'endroit où elle doit être effectuée."],
  },
  roles: { user: "Action requise", admin: "Examen du dossier", system: "Traitement système", complete: "Terminé" },
  phase1: {
    label: "Phase 1", titleLines: ["Compte et", "collecte"],
    description: "Créez le dossier, remplissez le questionnaire initial et examinez l'accord requis.",
    stages: ["Inscription", "Questionnaire", "Accord"],
  },
  phase2: {
    label: "Phase 2", titleLines: ["Examen", "sécurisé"],
    description: "Accédez à l'espace restreint, effectuez la vérification d'identité et soumettez la Déclaration de fonds.",
    stages: ["Portail restreint", "KYC", "Déclaration de fonds"],
  },
  phase3: {
    label: "Phase 3", titleLines: ["Opérations de", "récupération"],
    description: "Liez le mode de versement approuvé et suivez les activités de suivi et de récupération.",
    stages: ["Liaison et calibrage du portefeuille", "Suivi et récupération"],
  },
  phase4: {
    label: "Phase 4", titleLines: ["Finalisation", "du dossier"],
    description: "Finalisez la préparation du portefeuille séquestre et la récupération finale de séquence.",
    stages: ["Création du portefeuille séquestre crypto", "Récupération de séquence"],
  },
};

const de: VideoCaptions = {
  intro: {
    badge: "IBCCF-Portal-Leitfaden",
    titleLines: ["Ihr Fallablauf", "verständlich erklärt"],
    subtitleLines: ["10 Schritte. 4 klare Phasen.", "Sehen Sie, was als Nächstes passiert und wo jede Aktion hingehört."],
  },
  roles: { user: "Aktion erforderlich", admin: "Fallprüfung", system: "Systemverarbeitung", complete: "Abgeschlossen" },
  phase1: {
    label: "Phase 1", titleLines: ["Konto &", "Aufnahme"],
    description: "Erstellen Sie den Falldatensatz, füllen Sie den Fragebogen aus und prüfen Sie die erforderliche Vereinbarung.",
    stages: ["Registrierung", "Fragebogen", "Vereinbarung"],
  },
  phase2: {
    label: "Phase 2", titleLines: ["Sichere", "Prüfung"],
    description: "Öffnen Sie den geschützten Bereich, schließen Sie die Identitätsprüfung ab und reichen Sie die Gelderklärung ein.",
    stages: ["Geschütztes Portal", "KYC", "Gelderklärung"],
  },
  phase3: {
    label: "Phase 3", titleLines: ["Recovery-", "Vorgänge"],
    description: "Verknüpfen Sie die genehmigte Auszahlungsmethode und verfolgen Sie Tracking- und Recovery-Aktivitäten.",
    stages: ["Wallet-Verknüpfung & Kalibrierung", "Tracking & Recovery"],
  },
  phase4: {
    label: "Phase 4", titleLines: ["Finaler", "Abschluss"],
    description: "Schließen Sie die Escrow-Wallet-Vorbereitung und die abschließende Sequenz-Wiederherstellung ab.",
    stages: ["Krypto-Escrow-Wallet erstellen", "Sequenz-Wiederherstellung"],
  },
};

const pt: VideoCaptions = {
  intro: {
    badge: "Guia do Portal IBCCF",
    titleLines: ["Fluxo do seu caso", "explicado"],
    subtitleLines: ["10 etapas. 4 fases claras.", "Veja o que acontece em seguida e onde cada ação deve ser concluída."],
  },
  roles: { user: "Ação necessária", admin: "Revisão do caso", system: "Processamento do sistema", complete: "Concluído" },
  phase1: {
    label: "Fase 1", titleLines: ["Conta e", "cadastro"],
    description: "Crie o registro do caso, complete o questionário inicial e revise o acordo necessário.",
    stages: ["Cadastro", "Questionário", "Acordo"],
  },
  phase2: {
    label: "Fase 2", titleLines: ["Revisão", "segura"],
    description: "Acesse o espaço restrito, conclua a verificação de identidade e envie a Declaração de Fundos.",
    stages: ["Portal restrito", "KYC", "Declaração de Fundos"],
  },
  phase3: {
    label: "Fase 3", titleLines: ["Operações de", "recuperação"],
    description: "Vincule o método de pagamento aprovado e acompanhe as atividades de rastreamento e recuperação.",
    stages: ["Vinculação e calibração da carteira", "Rastreamento e recuperação"],
  },
  phase4: {
    label: "Fase 4", titleLines: ["Conclusão", "final"],
    description: "Conclua a preparação da carteira de custódia e a recuperação final da sequência.",
    stages: ["Criação de carteira de custódia cripto", "Recuperação de sequência"],
  },
};

const zh: VideoCaptions = {
  intro: {
    badge: "IBCCF 门户指南",
    titleLines: ["案件流程", "清晰说明"],
    subtitleLines: ["10 个步骤，4 个清晰阶段。", "了解下一步操作以及每项操作应在何处完成。"],
  },
  roles: { user: "需要操作", admin: "案件审核", system: "系统处理中", complete: "已完成" },
  phase1: {
    label: "第一阶段", titleLines: ["账户与", "资料收集"],
    description: "建立案件记录，完成初始问卷，并审阅所需协议。",
    stages: ["注册", "问卷", "协议"],
  },
  phase2: {
    label: "第二阶段", titleLines: ["安全", "审核"],
    description: "进入受限工作区，完成身份验证，并提交资金声明。",
    stages: ["受限门户", "KYC", "资金声明"],
  },
  phase3: {
    label: "第三阶段", titleLines: ["追踪与", "恢复"],
    description: "关联已批准的收款方式，并跟踪案件的追踪与恢复活动。",
    stages: ["钱包关联与校准", "追踪与恢复"],
  },
  phase4: {
    label: "第四阶段", titleLines: ["最终", "完成"],
    description: "完成加密托管钱包准备和最终序列恢复。",
    stages: ["创建加密托管钱包", "序列恢复"],
  },
};

export const VIDEO_CAPTIONS: Record<VideoLocaleCode, VideoCaptions> = {
  en, es, fr, de, pt, zh,
};

export const DEFAULT_VIDEO_LOCALE: VideoLocaleCode = "en";

export function resolveVideoLocaleCode(locale?: string | null): VideoLocaleCode {
  const base = (locale ?? DEFAULT_VIDEO_LOCALE).toLowerCase().split("-")[0] as VideoLocaleCode;
  return base in VIDEO_CAPTIONS ? base : DEFAULT_VIDEO_LOCALE;
}

export function resolveVideoCaptions(locale?: string | null): VideoCaptions {
  return VIDEO_CAPTIONS[resolveVideoLocaleCode(locale)];
}

export const NARRATION_SCENE_KEYS = [
  "intro",
  "phase1",
  "phase2",
  "phase3",
  "phase4",
] as const;

export type NarrationSceneKey = (typeof NARRATION_SCENE_KEYS)[number];

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

export const VideoCaptionsContext = createContext<VideoCaptions>(en);

export function useVideoCaptions(): VideoCaptions {
  return useContext(VideoCaptionsContext);
}
