// Sealed Settlement & NDA template — single source of truth for both the
// portal preview and the server-side PDF renderer. Version-tagged so a
// sealed case always re-renders against the version it was signed under
// (never the latest source), preserving the evidentiary chain.

export const NDA_TEMPLATE_VERSION = "v1.2026.08";

// Set to `true` once qualified counsel has reviewed and signed off on
// the es/fr/de/pt/zh bodies (Task #38). While `false`, the signing
// screen surfaces a courtesy-translation disclaimer to non-English
// signers stating that the English version controls. Flip this single
// flag to hide the banner globally once reviews are complete.
export const NDA_TRANSLATIONS_REVIEWED = false;

export const NDA_SUPPORTED_LOCALES = ["en", "es", "fr", "de", "pt", "zh"] as const;
export type NdaLocale = (typeof NDA_SUPPORTED_LOCALES)[number];
export const NDA_DEFAULT_LOCALE: NdaLocale = "en";

// Interim control: pin every NEW signing flow to an approved-for-signing
// allowlist of locales until counsel signs off on the rest of the
// translated settlement bodies (Task #38 / #61 / #88). Affects the
// preview + signature snapshot only; already-signed cases continue to
// re-render in their stored snapshot locale so the SHA-256 chain holds.
// English is always allowed (counsel has approved the authoritative
// English body); other locales are added incrementally as their
// translations clear legal review.
//
// This constant is the *boot default* only. The live runtime value is
// sourced server-side from the `app_settings` row keyed
// `nda_signing_locales` (Task #88, superseding the older boolean
// `english_only_signing` row from Task #61 — backfilled by migration
// `0008_backfill_nda_signing_locales` and the legacy compatibility
// layer retired in Task #95). The server returns the live allowlist
// on every NDA preview response (`signingLocales` field) so the signing
// screen reflects it on mount.
export const NDA_SIGNING_LOCALES_DEFAULT: readonly NdaLocale[] = ["en"];

export function normalizeNdaLocale(input: string | null | undefined): NdaLocale {
  if (!input) return NDA_DEFAULT_LOCALE;
  const base = input.toLowerCase().split(/[-_]/)[0];
  return (NDA_SUPPORTED_LOCALES as readonly string[]).includes(base)
    ? (base as NdaLocale)
    : NDA_DEFAULT_LOCALE;
}

// Locale to use for a NEW signing/preview interaction.
//
// - English is always treated as approved (counsel has signed off on the
//   authoritative English body); we add it to the allowlist defensively
//   so a misconfigured row can never lock signing out entirely.
// - When only English is approved, every fresh render — regardless of
//   the recipient's portal locale or any client-supplied override —
//   collapses to English.
// - When multiple locales are approved and the caller did not request a
//   specific one, we return `null` so downstream resolvers like
//   `buildNdaVarsForCase` can still fall back to the recipient's
//   persisted `preferredLocale`.
// - When the caller did request a locale that is NOT on the allowlist,
//   we silently clamp back to English instead of throwing — defence in
//   depth for stale clients. The server-side /sign route additionally
//   rejects such requests outright so the audit log is clean.
export function effectiveSigningLocale(
  requested: string | null | undefined,
  allowed: readonly NdaLocale[] = NDA_SIGNING_LOCALES_DEFAULT,
): NdaLocale | null {
  const allowSet = new Set<NdaLocale>(
    allowed.length > 0 ? allowed : [NDA_DEFAULT_LOCALE],
  );
  allowSet.add(NDA_DEFAULT_LOCALE);
  if (requested == null) {
    return allowSet.size === 1 ? NDA_DEFAULT_LOCALE : null;
  }
  const norm = normalizeNdaLocale(requested);
  return allowSet.has(norm) ? norm : NDA_DEFAULT_LOCALE;
}

/** True iff a locale is currently approved for new signing. English is
 *  always approved. */
export function isSigningLocaleAllowed(
  locale: string | null | undefined,
  allowed: readonly NdaLocale[] = NDA_SIGNING_LOCALES_DEFAULT,
): boolean {
  const norm = normalizeNdaLocale(locale);
  if (norm === NDA_DEFAULT_LOCALE) return true;
  return (allowed as readonly string[]).includes(norm);
}

export interface NdaTemplateVars {
  caseId: string;
  legalName: string;
  jurisdiction: string;
  effectiveDate: string;       // ISO date (YYYY-MM-DD) shown on the document
  settlementAmount: string;    // Free-form, includes currency unit
  payoutWalletAddress: string; // Display only; may be "Not on file"
  payoutWalletNetwork: string; // e.g. "TRC20"
  // Locale the body is rendered in. Defaults to English. Captured in the
  // snapshot so a later language switch on the case does NOT change the
  // bytes (and therefore the SHA-256) of an already-signed PDF.
  locale?: NdaLocale;
}

export interface NdaSection {
  heading: string;
  paragraphs: string[];
}

export interface NdaRendered {
  templateVersion: string;
  // Locale the body was rendered in. Persisted as part of the snapshot
  // so deterministic re-renders can reproduce the exact same bytes.
  locale: NdaLocale;
  title: string;
  subtitle: string;
  effectiveDateLabel: string;
  partyBlock: { label: string; value: string }[];
  recitals: string[];
  sections: NdaSection[];
  acknowledgement: string;
  signatureBlockLabels: {
    signed: string;
    typedName: string;
    date: string;
    ip: string;
    integrityHash: string;
    note: string;
    ibccfParty: string;
    recipientParty: string;
  };
}

// Localised strings for the legal body. The English version is the
// authoritative source; the other five locales are working translations
// intended for legal review before production rollout — the renderer
// itself is fully wired so once a translation is signed off, no further
// code changes are required.
//
// NOTE: changing any of the strings below for a locale produces a
// different PDF for cases signed under that locale. To preserve the
// evidentiary chain we ALSO record the locale on each snapshot, so a
// later edit to a translation never disturbs a previously-sealed case
// (re-render uses the stored locale + stored template version).
interface NdaStrings {
  title: string;
  subtitle: string;
  effectiveDateLabel: (date: string) => string;
  partyLabels: {
    caseRef: string;
    recipient: string;
    jurisdiction: string;
    settlementAmount: string;
    wallet: string;
  };
  walletFallback: string;
  walletNetworkSuffix: (network: string) => string;
  recitals: string[];
  sections: Array<{ heading: string; paragraphs: (vars: NdaTemplateVars) => string[] }>;
  acknowledgement: string;
  signatureBlock: NdaRendered["signatureBlockLabels"];
}

const STRINGS: Record<NdaLocale, NdaStrings> = {
  // ================================================================
  // ENGLISH — authoritative text
  // ================================================================
  en: {
    title: "Non-Disclosure, Confidentiality and Settlement Agreement",
    subtitle:
      "International Blockchain Community Complaints Forum — International Enforcement Division",
    effectiveDateLabel: (d) => `Effective date: ${d}`,
    partyLabels: {
      caseRef: "Case reference",
      recipient: "Recipient (legal name)",
      jurisdiction: "Governing jurisdiction",
      settlementAmount: "Settlement amount",
      wallet: "Verified payout wallet",
    },
    walletFallback: "Not on file at the time of signing",
    walletNetworkSuffix: (n) => ` (${n})`,
    recitals: [
      "WHEREAS the Recipient has progressed through the full IBCCF withdrawal and compliance workflow culminating in the final settlement stage;",
      "WHEREAS the parties intend to memorialise the closure of the case in a tamper-evident document bearing a cryptographic integrity hash; and",
      "WHEREAS the Recipient wishes to acknowledge the confidential and final nature of the settlement;",
      "NOW, THEREFORE, in consideration of the mutual covenants below, the Recipient agrees as follows:",
    ],
    sections: [
      {
        heading: "1. Definition",
        paragraphs: () => [
          '"Confidential Information" means any data or information that is proprietary to IBCCF and not generally known to the public, whether in tangible or intangible form, whenever and however disclosed, including but not limited to: the settlement amount, the verified payout wallet address and network, the contents of any withdrawal correspondence, compliance reports, procedural documentation, case file materials, internal communications, and the existence and terms of this Agreement. Confidential Information need not be novel, unique, patentable, or copyrightable to be so designated.',
          'The "Disclosing Party" means IBCCF International Enforcement Division, acting on behalf of the International Blockchain Community Complaints Forum. The "Receiving Party" or "Recipient" means the individual identified in the Parties & Particulars section above, who has been granted access to Confidential Information through the IBCCF withdrawal and settlement process. The Recipient acknowledges that all Confidential Information disclosed under this Agreement is proprietary to IBCCF and its affiliates.',
        ],
      },
      {
        heading: "2. Disclosure and Use of Confidential Information",
        paragraphs: () => [
          "The Recipient agrees to use the Confidential Information solely in connection with this settlement process and not for any other purpose whatsoever. Title to the Confidential Information shall remain solely with IBCCF. All use of Confidential Information by the Recipient shall be for the purposes of this settlement only.",
          "The Confidential Information shall not be disclosed to or provided to any third party except: (a) the Recipient's qualified legal, tax or accounting advisors who are bound by a professional duty of confidence; (b) a regulator or court of competent jurisdiction upon a lawfully issued order, subpoena or regulatory demand, provided that the Recipient notifies IBCCF in writing promptly and to the extent permitted by law; or (c) any other person to whom IBCCF has given prior written consent.",
          "The Recipient shall promptly notify IBCCF upon discovery of any unauthorised use or disclosure of Confidential Information and shall cooperate fully with IBCCF's efforts to regain possession of the Confidential Information and prevent its further unauthorised use or disclosure. This clause shall not apply to information that is or becomes publicly known other than through a breach of this Agreement.",
        ],
      },
      {
        heading: "3. Term",
        paragraphs: () => [
          "This Agreement shall come into effect upon the Recipient's execution and shall remain in full force for the duration of the settlement process and any subsequent period during which the Recipient retains Confidential Information. Notwithstanding any completion or termination of the settlement, the Recipient's duty to hold the Confidential Information in confidence shall remain in effect for a period of three (3) years from the date of this Agreement.",
        ],
      },
      {
        heading: "4. Return of Confidential Information",
        paragraphs: () => [
          "Upon the written request of IBCCF, or upon termination or completion of the settlement process, the Recipient shall promptly return and redeliver all tangible materials embodying the Confidential Information, including all notes, summaries, memoranda, records, extracts or derivative information, and all copies thereof, whether in physical, electronic or any other form of storage or retrieval. Where physical return is not practicable, the Recipient shall permanently delete or destroy all such materials and provide written confirmation of destruction upon request.",
          "If any materials are proprietary to the Recipient, they shall not be required to be returned to IBCCF, but the Recipient shall maintain their strict confidentiality in accordance with this Agreement.",
        ],
      },
      {
        heading: "5. Finality of Settlement",
        paragraphs: () => [
          "The Recipient acknowledges that the settlement reflected in the Parties & Particulars section above is full and final. The Recipient irrevocably releases IBCCF, its officers, directors, employees and affiliates from any further claim, demand, or proceeding arising from or connected to the underlying matter, save for fraud or wilful misconduct discovered after the date of this Agreement.",
          "Once this Agreement is executed, the case is permanently sealed in the IBCCF system. No further changes may be made to the case record except through IBCCF's documented Override-Seal procedure, which itself is recorded in the audit log and requires senior authorisation.",
        ],
      },
      {
        heading: "6. Limitation of Liability",
        paragraphs: () => [
          "The Recipient hereby agrees to indemnify and hold harmless IBCCF and its affiliates, officers, directors, employees and representatives from and against any and all losses, damages, suits, proceedings, claims, demands, liabilities, costs and expenses (whether direct or indirect, and whether or not resulting from third-party claims), including reasonable legal fees and disbursements, arising out of or resulting from any breach of this Agreement by the Recipient, including any unauthorised use or disclosure of Confidential Information.",
          "This indemnification obligation shall survive the termination of this Agreement and shall remain in effect for as long as the Recipient or their representatives retain any Confidential Information belonging to IBCCF. Liability under this Agreement commences upon execution and applies to all Confidential Information received or accessed during the settlement process.",
        ],
      },
      {
        heading: "7. Integrity Hash & Evidentiary Record",
        paragraphs: () => [
          "This document is rendered to a PDF whose SHA-256 hash is computed at the moment of signing. The hash is displayed to the Recipient in their portal and stored alongside the signed document. Any future alteration to the document will produce a different hash and is therefore detectable.",
          "The signed document, the SHA-256 hash, the Recipient's typed-name signature, the signing timestamp, the originating IP address and the user-agent string together constitute the evidentiary record of this Agreement.",
        ],
      },
      {
        heading: "8. Governing Law and Jurisdiction",
        paragraphs: (v) => [
          `This Agreement shall be governed by and construed in accordance with the laws of ${v.jurisdiction}, without regard to conflict of law principles. In the event of any dispute arising out of or relating to this Agreement, the parties agree to submit to the non-exclusive jurisdiction of the competent courts in that jurisdiction. Each party hereby consents to such jurisdiction for the purposes of resolving any such disputes.`,
        ],
      },
      {
        heading: "9. Entire Agreement",
        paragraphs: () => [
          "This Agreement, together with the case record and the documents it references, constitutes the entire agreement between the parties with respect to the closure of the case. It supersedes all prior negotiations and understandings on this subject. If any provision is held unenforceable, the remainder shall continue in full force.",
        ],
      },
    ],
    acknowledgement:
      "I have read and understood all provisions of this Non-Disclosure, Confidentiality and Settlement Agreement. By typing my full legal name below and submitting this form:\n\n(1) I agree with the obligations and responsibilities set out in this Agreement;\n\n(2) I acknowledge that the settlement reflected above is full and final, and I release IBCCF from any further claims arising from the underlying matter;\n\n(3) I understand that any misuse of Confidential Information, whether intentional or through negligence, constitutes a breach of this Agreement and may subject me to civil legal proceedings and termination of the settlement arrangement; and\n\n(4) I confirm that my typed-name signature, together with the SHA-256 integrity hash of this document, forms the binding evidentiary record of this acknowledgement.",
    signatureBlock: {
      signed: "Signed (typed)",
      typedName: "Typed name",
      date: "Signed at (UTC)",
      ip: "Originating IP",
      integrityHash: "SHA-256 (this PDF)",
      note: "This typed signature, together with the integrity hash above, forms the evidentiary record of this acknowledgement.",
      ibccfParty: "IBCCF International Enforcement Division",
      recipientParty: "Recipient (Digital Signature)",
    },
  },

  // ================================================================
  // SPANISH — working translation; pending legal review
  // ================================================================
  es: {
    title: "Acuerdo de No Divulgación, Confidencialidad y Liquidación",
    subtitle:
      "Foro Internacional de Reclamaciones de la Comunidad Blockchain — División Internacional de Cumplimiento",
    effectiveDateLabel: (d) => `Fecha de vigencia: ${d}`,
    partyLabels: {
      caseRef: "Referencia del caso",
      recipient: "Beneficiario (nombre legal)",
      jurisdiction: "Jurisdicción aplicable",
      settlementAmount: "Importe de la liquidación",
      wallet: "Monedero de pago verificado",
    },
    walletFallback: "No registrado en el momento de la firma",
    walletNetworkSuffix: (n) => ` (${n})`,
    recitals: [
      "POR CUANTO el Beneficiario ha completado la totalidad del proceso de retirada y cumplimiento del IBCCF, culminando en la fase final de liquidación;",
      "POR CUANTO las partes desean formalizar el cierre del caso mediante un documento a prueba de manipulaciones, identificado por un hash criptográfico de integridad; y",
      "POR CUANTO el Beneficiario desea reconocer el carácter confidencial y definitivo de la liquidación;",
      "POR LO TANTO, en consideración de los compromisos mutuos que figuran a continuación, el Beneficiario acuerda lo siguiente:",
    ],
    sections: [
      {
        heading: "1. Definición",
        paragraphs: () => [
          '"Información Confidencial" significa cualquier dato o información que sea propiedad del IBCCF y no sea generalmente conocida por el público, en forma tangible o intangible, incluidos entre otros: el importe de la liquidación, la dirección y red de la cartera de pago verificada, el contenido de cualquier correspondencia de retirada, informes de cumplimiento, documentación procesal, materiales del expediente del caso y la existencia y condiciones del presente Acuerdo. La Información Confidencial no necesita ser novedosa, única, patentable o registrable para ser así designada.',
          'La "Parte Divulgadora" es la División Internacional de Cumplimiento del IBCCF. La "Parte Receptora" o "Beneficiario" es la persona identificada en la sección de Partes y Datos anterior, a quien se ha concedido acceso a Información Confidencial en el marco del proceso de retirada y liquidación del IBCCF. El Beneficiario reconoce que toda la Información Confidencial es propiedad del IBCCF y sus afiliados.',
        ],
      },
      {
        heading: "2. Divulgación y uso de la información confidencial",
        paragraphs: () => [
          "El Beneficiario se compromete a utilizar la Información Confidencial únicamente en relación con el proceso de liquidación vigente y no para ningún otro fin. La titularidad de la Información Confidencial corresponderá exclusivamente al IBCCF. Todo uso de la Información Confidencial por parte del Beneficiario se realizará únicamente a los efectos de esta liquidación.",
          "La Información Confidencial no será divulgada ni facilitada a terceros, salvo: (a) asesores jurídicos, fiscales o contables cualificados del Beneficiario sujetos al deber profesional de confidencialidad; (b) un regulador o tribunal competente en virtud de una orden legalmente emitida, siempre que el Beneficiario notifique al IBCCF por escrito en la medida que permita la ley; o (c) cualquier otra persona a quien el IBCCF haya dado consentimiento previo por escrito.",
          "El Beneficiario notificará al IBCCF de inmediato cuando descubra cualquier uso o divulgación no autorizados de la Información Confidencial y cooperará con los esfuerzos del IBCCF para recuperarla y prevenir un uso posterior no autorizado. Esta cláusula no se aplicará a información que sea o se convierta en pública por motivos distintos al incumplimiento de este Acuerdo.",
        ],
      },
      {
        heading: "3. Vigencia",
        paragraphs: () => [
          "Este Acuerdo entrará en vigor a partir de su firma por el Beneficiario y permanecerá en plena vigencia durante el proceso de liquidación y cualquier período posterior en que el Beneficiario conserve Información Confidencial. No obstante lo anterior, la obligación del Beneficiario de mantener la confidencialidad seguirá vigente durante tres (3) años desde la fecha del presente Acuerdo.",
        ],
      },
      {
        heading: "4. Devolución de la información confidencial",
        paragraphs: () => [
          "A solicitud escrita del IBCCF, o a la terminación o finalización del proceso de liquidación, el Beneficiario devolverá todos los materiales tangibles que contengan Información Confidencial, incluidas notas, resúmenes, memorandos, registros, extractos o información derivada, y todas sus copias, ya sea en formato físico, electrónico o cualquier otro. En caso de que la devolución física no sea factible, el Beneficiario eliminará o destruirá de forma permanente dichos materiales y proporcionará confirmación escrita de la destrucción a requerimiento del IBCCF.",
          "Si algún material es propiedad del Beneficiario, no se exigirá su devolución al IBCCF, pero el Beneficiario mantendrá su estricta confidencialidad de conformidad con este Acuerdo.",
        ],
      },
      {
        heading: "5. Carácter definitivo de la liquidación",
        paragraphs: () => [
          "El Beneficiario reconoce que la liquidación indicada en la sección de Partes y Datos es total y definitiva. El Beneficiario libera irrevocablemente al IBCCF, sus directivos, empleados y afiliados de cualquier reclamación posterior derivada del asunto subyacente, salvo fraude o conducta dolosa descubiertos con posterioridad a la fecha de este Acuerdo.",
          "Una vez ejecutado el presente Acuerdo, el caso queda permanentemente sellado en el sistema IBCCF. No podrán efectuarse modificaciones adicionales al expediente del caso salvo mediante el procedimiento documentado de Anulación del Sello del IBCCF, que a su vez queda registrado en el registro de auditoría.",
        ],
      },
      {
        heading: "6. Limitación de responsabilidad",
        paragraphs: () => [
          "El Beneficiario acuerda indemnizar y mantener indemne al IBCCF y a sus afiliados, directivos, empleados y representantes frente a todas las pérdidas, daños, litigios, reclamaciones, demandas, responsabilidades, costes y gastos (directos o indirectos), incluidos honorarios legales razonables, derivados de cualquier incumplimiento de este Acuerdo por parte del Beneficiario, incluido el uso o la divulgación no autorizados de Información Confidencial.",
          "Esta obligación de indemnización sobrevivirá a la terminación del Acuerdo y permanecerá vigente mientras el Beneficiario o sus representantes conserven Información Confidencial del IBCCF. La responsabilidad comienza desde la fecha de firma y se aplica a toda Información Confidencial recibida o accedida durante el proceso de liquidación.",
        ],
      },
      {
        heading: "7. Hash de integridad y registro probatorio",
        paragraphs: () => [
          "Este documento se genera como un PDF cuyo hash SHA-256 se calcula en el momento de la firma. El hash se muestra al Beneficiario en su portal y se almacena junto con el documento firmado. Cualquier alteración futura del documento generará un hash distinto y, por tanto, será detectable.",
          "El documento firmado, el hash SHA-256, la firma del Beneficiario mediante nombre escrito, la marca temporal de la firma, la dirección IP de origen y la cadena del agente de usuario constituyen, en su conjunto, el registro probatorio del presente Acuerdo.",
        ],
      },
      {
        heading: "8. Ley aplicable y jurisdicción",
        paragraphs: (v) => [
          `El presente Acuerdo se regirá e interpretará de conformidad con las leyes de ${v.jurisdiction}, sin considerar sus disposiciones sobre conflicto de leyes. En caso de controversia relativa a este Acuerdo, las partes acuerdan someterse a la jurisdicción no exclusiva de los tribunales competentes de dicha jurisdicción. Cada parte consiente expresamente dicha jurisdicción para la resolución de cualquier controversia.`,
        ],
      },
      {
        heading: "9. Acuerdo íntegro",
        paragraphs: () => [
          "El presente Acuerdo, junto con el expediente del caso y los documentos a los que hace referencia, constituye el acuerdo íntegro entre las partes respecto al cierre del caso. Sustituye a todas las negociaciones y entendimientos previos sobre la materia. Si alguna disposición se considerara inejecutable, el resto continuará en pleno vigor.",
        ],
      },
    ],
    acknowledgement:
      "He leído y comprendido todas las disposiciones del presente Acuerdo de No Divulgación, Confidencialidad y Liquidación. Al escribir mi nombre legal completo a continuación y enviar este formulario:\n\n(1) acepto las obligaciones y responsabilidades establecidas en este Acuerdo;\n\n(2) reconozco que la liquidación indicada es total y definitiva, y libero al IBCCF de cualquier reclamación ulterior derivada del asunto subyacente;\n\n(3) entiendo que cualquier uso indebido de la Información Confidencial, ya sea intencional o por negligencia, constituye un incumplimiento de este Acuerdo y puede exponerme a acciones civiles y a la resolución del acuerdo de liquidación; y\n\n(4) confirmo que mi firma mediante nombre escrito, junto con el hash SHA-256 de integridad de este documento, constituye el registro probatorio vinculante de mi reconocimiento.",
    signatureBlock: {
      signed: "Firmado (escrito)",
      typedName: "Nombre escrito",
      date: "Firmado el (UTC)",
      ip: "IP de origen",
      integrityHash: "SHA-256 (este PDF)",
      note: "Esta firma escrita, junto con el hash de integridad anterior, constituye el registro probatorio del presente acuerdo.",
      ibccfParty: "División Internacional de Cumplimiento del IBCCF",
      recipientParty: "Beneficiario (Firma Digital)",
    },
  },

  // ================================================================
  // FRENCH — working translation; pending legal review
  // ================================================================
  fr: {
    title: "Accord de Non-Divulgation, de Confidentialité et de Règlement",
    subtitle:
      "Forum International des Plaintes de la Communauté Blockchain — Division Internationale d'Application",
    effectiveDateLabel: (d) => `Date d'effet : ${d}`,
    partyLabels: {
      caseRef: "Référence du dossier",
      recipient: "Bénéficiaire (nom légal)",
      jurisdiction: "Juridiction applicable",
      settlementAmount: "Montant du règlement",
      wallet: "Portefeuille de paiement vérifié",
    },
    walletFallback: "Non enregistré au moment de la signature",
    walletNetworkSuffix: (n) => ` (${n})`,
    recitals: [
      "ATTENDU QUE le Bénéficiaire a parcouru l'intégralité du processus de retrait et de conformité de l'IBCCF, jusqu'à la phase finale de règlement ;",
      "ATTENDU QUE les parties entendent acter la clôture du dossier au moyen d'un document infalsifiable comportant une empreinte cryptographique d'intégrité ; et",
      "ATTENDU QUE le Bénéficiaire souhaite reconnaître le caractère confidentiel et définitif du règlement ;",
      "EN CONSÉQUENCE, en contrepartie des engagements mutuels exposés ci-après, le Bénéficiaire convient de ce qui suit :",
    ],
    sections: [
      {
        heading: "1. Définition",
        paragraphs: () => [
          "Les « Informations confidentielles » désignent toute donnée ou information propriété de l'IBCCF et non généralement connue du public, sous toute forme tangible ou intangible, notamment : le montant du règlement, l'adresse et le réseau du portefeuille de paiement vérifié, le contenu de toute correspondance de retrait, les rapports de conformité, la documentation procédurale, les pièces du dossier ainsi que l'existence et les conditions du présent Accord. Les Informations confidentielles n'ont pas besoin d'être nouvelles, uniques, brevetables ou soumises aux droits d'auteur pour être ainsi qualifiées.",
          "La « Partie divulgante » désigne la Division internationale d'application de l'IBCCF. La « Partie réceptrice » ou le « Bénéficiaire » désigne la personne identifiée à la section Parties et informations ci-dessus, à qui l'accès aux Informations confidentielles a été accordé dans le cadre du processus de retrait et de règlement de l'IBCCF. Le Bénéficiaire reconnaît que toutes les Informations confidentielles sont la propriété de l'IBCCF et de ses affiliés.",
        ],
      },
      {
        heading: "2. Divulgation et utilisation des informations confidentielles",
        paragraphs: () => [
          "Le Bénéficiaire s'engage à utiliser les Informations confidentielles uniquement dans le cadre du présent processus de règlement et à aucune autre fin. La propriété des Informations confidentielles demeurera exclusivement à l'IBCCF. Toute utilisation des Informations confidentielles par le Bénéficiaire sera effectuée aux seules fins de ce règlement.",
          "Les Informations confidentielles ne seront pas divulguées à des tiers, sauf : (a) aux conseillers juridiques, fiscaux ou comptables qualifiés du Bénéficiaire tenus à un devoir de confidentialité professionnel ; (b) à un régulateur ou un tribunal compétent sur la base d'une ordonnance légalement émise, à condition que le Bénéficiaire notifie l'IBCCF par écrit dans les meilleurs délais dans la mesure permise par la loi ; ou (c) à toute autre personne pour laquelle l'IBCCF a donné son consentement écrit préalable.",
          "Le Bénéficiaire notifiera sans délai l'IBCCF de toute utilisation ou divulgation non autorisée des Informations confidentielles et coopérera pleinement avec l'IBCCF pour récupérer ces informations et prévenir toute utilisation non autorisée ultérieure. Cette clause ne s'applique pas aux informations qui deviennent publiques autrement que par une violation du présent Accord.",
        ],
      },
      {
        heading: "3. Durée",
        paragraphs: () => [
          "Le présent Accord entre en vigueur à la signature du Bénéficiaire et reste pleinement en vigueur pendant toute la durée du processus de règlement et toute période postérieure pendant laquelle le Bénéficiaire détient des Informations confidentielles. Nonobstant toute résiliation ou achèvement du règlement, l'obligation du Bénéficiaire de maintenir la confidentialité reste en vigueur pendant une période de trois (3) ans à compter de la date du présent Accord.",
        ],
      },
      {
        heading: "4. Restitution des informations confidentielles",
        paragraphs: () => [
          "Sur demande écrite de l'IBCCF, ou lors de la résiliation ou de l'achèvement du processus de règlement, le Bénéficiaire restituera sans délai tous les supports tangibles contenant les Informations confidentielles, notamment toutes les notes, résumés, mémorandums, registres, extraits ou informations dérivées, ainsi que toutes leurs copies, en format physique, électronique ou autre. Lorsque la restitution physique n'est pas praticable, le Bénéficiaire détruira définitivement ces supports et fournira une confirmation écrite de la destruction sur demande.",
          "Les supports appartenant au Bénéficiaire n'ont pas à être restitués à l'IBCCF, mais le Bénéficiaire en assurera la stricte confidentialité conformément au présent Accord.",
        ],
      },
      {
        heading: "5. Caractère définitif du règlement",
        paragraphs: () => [
          "Le Bénéficiaire reconnaît que le règlement indiqué dans la section Parties et informations est intégral et définitif. Le Bénéficiaire libère irrévocablement l'IBCCF, ses dirigeants, directeurs, employés et affiliés de toute réclamation ultérieure liée à l'affaire sous-jacente, sauf en cas de fraude ou de faute intentionnelle découverte après la date du présent Accord.",
          "Une fois le présent Accord signé, le dossier est définitivement scellé dans le système de l'IBCCF. Aucune modification ultérieure du dossier ne peut être effectuée, sauf par la procédure documentée de Levée de Scellé de l'IBCCF, consignée dans le journal d'audit.",
        ],
      },
      {
        heading: "6. Limitation de responsabilité",
        paragraphs: () => [
          "Le Bénéficiaire s'engage à indemniser et dégager l'IBCCF et ses affiliés, dirigeants, directeurs, employés et représentants de toute responsabilité à l'égard de toutes pertes, dommages, actions en justice, réclamations, demandes, responsabilités, frais et dépenses (directs ou indirects), y compris des honoraires juridiques raisonnables, résultant de tout manquement du Bénéficiaire aux obligations du présent Accord, notamment de toute utilisation ou divulgation non autorisée d'Informations confidentielles.",
          "Cette obligation d'indemnisation survivra à la résiliation du présent Accord et restera en vigueur aussi longtemps que le Bénéficiaire ou ses représentants détiennent des Informations confidentielles appartenant à l'IBCCF. La responsabilité commence à la date de signature et s'applique à toutes les Informations confidentielles reçues ou consultées durant le processus de règlement.",
        ],
      },
      {
        heading: "7. Empreinte d'intégrité et enregistrement probatoire",
        paragraphs: () => [
          "Le présent document est rendu sous forme de PDF dont l'empreinte SHA-256 est calculée au moment de la signature. L'empreinte est affichée au Bénéficiaire dans son portail et conservée avec le document signé. Toute altération ultérieure du document produira une empreinte différente et sera donc détectable.",
          "Le document signé, l'empreinte SHA-256, la signature dactylographiée du Bénéficiaire, l'horodatage de la signature, l'adresse IP d'origine et la chaîne d'agent utilisateur constituent ensemble l'enregistrement probatoire du présent Accord.",
        ],
      },
      {
        heading: "8. Loi applicable et juridiction",
        paragraphs: (v) => [
          `Le présent Accord est régi et interprété conformément aux lois de ${v.jurisdiction}, sans égard à ses règles de conflit de lois. En cas de litige relatif au présent Accord, les parties acceptent de se soumettre à la compétence non exclusive des tribunaux compétents de cette juridiction. Chaque partie consent expressément à cette compétence pour la résolution de tout litige.`,
        ],
      },
      {
        heading: "9. Intégralité de l'accord",
        paragraphs: () => [
          "Le présent Accord, conjointement avec le dossier et les documents qu'il référence, constitue l'intégralité de l'accord entre les parties concernant la clôture du dossier. Il remplace toutes les négociations et ententes antérieures sur ce sujet. Si une disposition est jugée inapplicable, le reste demeurera pleinement en vigueur.",
        ],
      },
    ],
    acknowledgement:
      "J'ai lu et compris toutes les dispositions du présent Accord de Non-Divulgation, de Confidentialité et de Règlement. En saisissant mon nom légal complet ci-dessous et en soumettant ce formulaire :\n\n(1) j'accepte les obligations et responsabilités énoncées dans le présent Accord ;\n\n(2) je reconnais que le règlement indiqué ci-dessus est intégral et définitif, et je libère l'IBCCF de toute réclamation ultérieure liée à l'affaire sous-jacente ;\n\n(3) je comprends que toute utilisation abusive des Informations confidentielles, qu'elle soit intentionnelle ou due à la négligence, constitue une violation du présent Accord et peut m'exposer à des poursuites civiles et à la résiliation de l'accord de règlement ; et\n\n(4) je confirme que ma signature dactylographiée, associée à l'empreinte d'intégrité SHA-256 de ce document, constitue l'enregistrement probatoire contraignant de ma reconnaissance.",
    signatureBlock: {
      signed: "Signé (dactylographié)",
      typedName: "Nom saisi",
      date: "Signé le (UTC)",
      ip: "IP d'origine",
      integrityHash: "SHA-256 (ce PDF)",
      note: "Cette signature dactylographiée, ainsi que l'empreinte d'intégrité ci-dessus, constitue l'enregistrement probatoire du présent accord.",
      ibccfParty: "Division Internationale d'Application de l'IBCCF",
      recipientParty: "Bénéficiaire (Signature Numérique)",
    },
  },

  // ================================================================
  // GERMAN — working translation; pending legal review
  // ================================================================
  de: {
    title: "Geheimhaltungs-, Vertraulichkeits- und Vergleichsvertrag",
    subtitle:
      "Internationales Beschwerdeforum der Blockchain-Gemeinschaft — Internationale Vollzugsabteilung",
    effectiveDateLabel: (d) => `Stichtag: ${d}`,
    partyLabels: {
      caseRef: "Fallnummer",
      recipient: "Empfänger (vollständiger Name)",
      jurisdiction: "Maßgebliches Recht",
      settlementAmount: "Vergleichssumme",
      wallet: "Verifizierte Auszahlungsadresse",
    },
    walletFallback: "Zum Zeitpunkt der Unterzeichnung nicht hinterlegt",
    walletNetworkSuffix: (n) => ` (${n})`,
    recitals: [
      "IN ANBETRACHT DESSEN, dass der Empfänger den gesamten Auszahlungs- und Compliance-Prozess des IBCCF bis zur abschließenden Vergleichsphase durchlaufen hat;",
      "IN ANBETRACHT DESSEN, dass die Parteien den Abschluss des Falls mittels eines manipulationssicheren Dokuments mit kryptographischer Integritätsprüfsumme festhalten möchten; und",
      "IN ANBETRACHT DESSEN, dass der Empfänger den vertraulichen und endgültigen Charakter des Vergleichs anerkennen möchte;",
      "WIRD HIERMIT, in Anbetracht der nachstehenden gegenseitigen Verpflichtungen, vom Empfänger Folgendes vereinbart:",
    ],
    sections: [
      {
        heading: "1. Definition",
        paragraphs: () => [
          '„Vertrauliche Informationen" sind alle Daten und Informationen, die Eigentum des IBCCF sind und der Öffentlichkeit nicht allgemein bekannt sind, ob in greifbarer oder nicht greifbarer Form, einschließlich u.\u00a0a.: dem Vergleichsbetrag, der verifizierten Auszahlungsadresse und dem Netzwerk, dem Inhalt jeglicher Auszahlungskorrespondenz, Compliance-Berichten, Verfahrensunterlagen, Fallakteninhalten sowie der Existenz und den Bedingungen dieses Vertrags. Vertrauliche Informationen müssen nicht neuartig, einzigartig, patentierbar oder urheberrechtlich geschützt sein, um als solche eingestuft zu werden.',
          'Die \u201eOffenlegende Partei\u201c ist die Internationale Vollzugsabteilung des IBCCF. Die \u201eEmpfangende Partei\u201c oder der \u201eEmpf\u00e4nger\u201c ist die in dem obigen Abschnitt \u201eParteien und Angaben\u201c genannte Person, der im Rahmen des IBCCF-Auszahlungs- und Abwicklungsprozesses Zugang zu Vertraulichen Informationen gew\u00e4hrt wurde. Der Empf\u00e4nger erkennt an, dass alle Vertraulichen Informationen Eigentum des IBCCF und seiner verbundenen Unternehmen sind.',
        ],
      },
      {
        heading: "2. Offenlegung und Nutzung vertraulicher Informationen",
        paragraphs: () => [
          "Der Empfänger verpflichtet sich, die Vertraulichen Informationen ausschließlich im Zusammenhang mit dem laufenden Abwicklungsprozess und nicht für andere Zwecke zu nutzen. Das Eigentum an den Vertraulichen Informationen verbleibt ausschließlich beim IBCCF. Jede Nutzung der Vertraulichen Informationen durch den Empfänger erfolgt ausschließlich im Rahmen dieser Abwicklung.",
          "Vertrauliche Informationen dürfen nur weitergegeben werden an: (a) qualifizierte Rechts-, Steuer- oder Buchführungsberater des Empfängers, die einer professionellen Verschwiegenheitspflicht unterliegen; (b) eine Aufsichtsbehörde oder ein zuständiges Gericht auf Grundlage einer rechtmäßig erlassenen Anordnung, sofern der Empfänger das IBCCF so schnell wie möglich und soweit gesetzlich zulässig schriftlich benachrichtigt; oder (c) jede andere Person, der das IBCCF vorab schriftlich zugestimmt hat.",
          "Der Empfänger hat das IBCCF unverzüglich über eine nicht autorisierte Nutzung oder Weitergabe von Vertraulichen Informationen zu informieren und muss bei der Wiedererlangung der Informationen und der Verhinderung weiterer nicht autorisierter Nutzung vollständig kooperieren. Diese Klausel gilt nicht für Informationen, die auf andere Weise als durch einen Verstoß gegen diesen Vertrag öffentlich werden.",
        ],
      },
      {
        heading: "3. Laufzeit und Dauer",
        paragraphs: () => [
          "Dieser Vertrag tritt mit der Unterzeichnung durch den Empfänger in Kraft und bleibt für die Dauer des Abwicklungsprozesses und jeden anschließenden Zeitraum, in dem der Empfänger Vertrauliche Informationen besitzt, in voller Gültigkeit. Ungeachtet jeder Beendigung oder des Abschlusses der Abwicklung gilt die Verschwiegenheitspflicht des Empfängers für einen Zeitraum von drei (3) Jahren ab dem Datum dieses Vertrags.",
        ],
      },
      {
        heading: "4. Rückgabe vertraulicher Informationen",
        paragraphs: () => [
          "Auf schriftliche Anfrage des IBCCF oder nach Beendigung oder Abschluss des Abwicklungsprozesses hat der Empfänger alle greifbaren Materialien, die Vertrauliche Informationen enthalten – einschließlich Notizen, Zusammenfassungen, Memoranden, Aufzeichnungen, Auszüge oder abgeleitete Informationen und alle Kopien davon in physischer, elektronischer oder anderer Form – unverzüglich zurückzugeben. Sofern eine physische Rückgabe nicht praktikabel ist, sind die Materialien dauerhaft zu löschen oder zu vernichten und auf Anfrage ist eine schriftliche Vernichtungsbestätigung vorzulegen.",
          "Materialien, die Eigentum des Empfängers sind, müssen nicht an das IBCCF zurückgegeben werden; der Empfänger ist jedoch verpflichtet, sie gemäß diesem Vertrag streng vertraulich zu behandeln.",
        ],
      },
      {
        heading: "5. Endgültigkeit des Vergleichs",
        paragraphs: () => [
          'Der Empf\u00e4nger erkennt an, dass der im Abschnitt \u201eParteien und Angaben\u201c aufgef\u00fchrte Vergleich vollst\u00e4ndig und endg\u00fcltig ist. Der Empf\u00e4nger entbindet unwiderruflich das IBCCF, seine leitenden Angestellten, Direktoren, Mitarbeiter und verbundene Unternehmen von allen weiteren Anspr\u00fcchen, die aus dem zugrundeliegenden Sachverhalt entstehen, mit Ausnahme von Betrug oder vors\u00e4tzlichem Fehlverhalten, das nach dem Datum dieses Vertrags entdeckt wird.',
          "Nach Unterzeichnung dieses Vertrags wird der Fall dauerhaft im IBCCF-System versiegelt. Weitere Änderungen an der Fallakte sind ausschließlich über das dokumentierte Siegel-Aufhebungsverfahren des IBCCF zulässig, das im Audit-Protokoll erfasst wird.",
        ],
      },
      {
        heading: "6. Haftungsbeschränkung",
        paragraphs: () => [
          "Der Empfänger verpflichtet sich, das IBCCF und seine verbundenen Unternehmen, leitenden Angestellten, Direktoren, Mitarbeiter und Vertreter von allen Verlusten, Schäden, Klagen, Forderungen, Verbindlichkeiten, Kosten und Ausgaben (direkte oder indirekte), einschließlich angemessener Anwaltskosten, freizustellen und zu entschädigen, die aus einem Verstoß gegen diesen Vertrag durch den Empfänger entstehen, einschließlich unbefugter Nutzung oder Weitergabe von Vertraulichen Informationen.",
          "Diese Entschädigungspflicht überlebt die Kündigung dieses Vertrags und bleibt so lange in Kraft, wie der Empfänger oder seine Vertreter Vertrauliche Informationen des IBCCF besitzen. Die Haftung beginnt ab dem Datum der Unterzeichnung und gilt für alle Vertraulichen Informationen, die während des Abwicklungsprozesses empfangen oder abgerufen wurden.",
        ],
      },
      {
        heading: "7. Integritätsprüfsumme und Beweisaufzeichnung",
        paragraphs: () => [
          "Dieses Dokument wird als PDF erzeugt, dessen SHA-256-Prüfsumme im Moment der Unterzeichnung berechnet wird. Die Prüfsumme wird dem Empfänger im Portal angezeigt und gemeinsam mit dem signierten Dokument gespeichert. Jede künftige Änderung des Dokuments erzeugt eine andere Prüfsumme und ist daher erkennbar.",
          "Das unterzeichnete Dokument, die SHA-256-Prüfsumme, die eingetippte Namensunterschrift des Empfängers, der Zeitstempel der Unterzeichnung, die ursprüngliche IP-Adresse sowie die User-Agent-Zeichenkette bilden zusammen die Beweisaufzeichnung dieses Vertrags.",
        ],
      },
      {
        heading: "8. Anwendbares Recht und Gerichtsstand",
        paragraphs: (v) => [
          `Dieser Vertrag unterliegt dem Recht von ${v.jurisdiction} und ist nach diesem auszulegen, unter Ausschluss seiner Kollisionsnormen. Bei Streitigkeiten aus oder im Zusammenhang mit diesem Vertrag unterwerfen sich die Parteien der nicht ausschließlichen Zuständigkeit der zuständigen Gerichte dieser Jurisdiktion. Jede Partei erklärt hiermit ausdrücklich ihre Zustimmung zur Zuständigkeit dieser Gerichte zur Beilegung etwaiger Streitigkeiten.`,
        ],
      },
      {
        heading: "9. Gesamte Vereinbarung",
        paragraphs: () => [
          "Dieser Vertrag stellt zusammen mit der Fallakte und den darin referenzierten Dokumenten die gesamte Vereinbarung der Parteien hinsichtlich des Fallabschlusses dar. Er ersetzt alle früheren Verhandlungen und Vereinbarungen zu diesem Thema. Sollte eine Bestimmung undurchsetzbar sein, bleiben die übrigen Bestimmungen vollumfänglich in Kraft.",
        ],
      },
    ],
    acknowledgement:
      "Ich habe alle Bestimmungen dieses Geheimhaltungs-, Vertraulichkeits- und Vergleichsvertrags gelesen und verstanden. Durch die Eingabe meines vollständigen rechtlichen Namens und die Übermittlung dieses Formulars:\n\n(1) stimme ich den in diesem Vertrag dargelegten Pflichten und Verantwortlichkeiten zu;\n\n(2) erkenne ich an, dass der oben aufgeführte Vergleich vollständig und endgültig ist, und entbinde das IBCCF von weiteren Ansprüchen aus dem zugrundeliegenden Sachverhalt;\n\n(3) verstehe ich, dass jeder Missbrauch von Vertraulichen Informationen, ob vorsätzlich oder fahrlässig, einen Vertragsbruch darstellt und mich zivilrechtlichen Verfahren und der Aufhebung der Vergleichsvereinbarung aussetzen kann; und\n\n(4) bestätige ich, dass meine eingetippte Namensunterschrift zusammen mit der SHA-256-Integritätsprüfsumme dieses Dokuments das verbindliche Beweisdokument dieser Erklärung bildet.",
    signatureBlock: {
      signed: "Unterzeichnet (getippt)",
      typedName: "Eingegebener Name",
      date: "Unterzeichnet am (UTC)",
      ip: "Ursprungs-IP",
      integrityHash: "SHA-256 (dieses PDF)",
      note: "Diese eingetippte Unterschrift bildet zusammen mit der obigen Integritätsprüfsumme die Beweisaufzeichnung dieser Erklärung.",
      ibccfParty: "Internationale Vollzugsabteilung des IBCCF",
      recipientParty: "Empfänger (Digitale Unterschrift)",
    },
  },

  // ================================================================
  // PORTUGUESE — working translation; pending legal review
  // ================================================================
  pt: {
    title: "Acordo de Não Divulgação, Confidencialidade e Liquidação",
    subtitle:
      "Fórum Internacional de Reclamações da Comunidade Blockchain — Divisão Internacional de Aplicação",
    effectiveDateLabel: (d) => `Data de vigência: ${d}`,
    partyLabels: {
      caseRef: "Referência do caso",
      recipient: "Beneficiário (nome legal)",
      jurisdiction: "Jurisdição aplicável",
      settlementAmount: "Valor da liquidação",
      wallet: "Carteira de pagamento verificada",
    },
    walletFallback: "Não registada no momento da assinatura",
    walletNetworkSuffix: (n) => ` (${n})`,
    recitals: [
      "CONSIDERANDO QUE o Beneficiário concluiu a totalidade do processo de levantamento e conformidade do IBCCF, culminando na fase final de liquidação;",
      "CONSIDERANDO QUE as partes pretendem formalizar o encerramento do caso através de um documento à prova de adulteração, identificado por uma impressão criptográfica de integridade; e",
      "CONSIDERANDO QUE o Beneficiário deseja reconhecer o carácter confidencial e definitivo da liquidação;",
      "PORTANTO, em contrapartida dos compromissos mútuos abaixo, o Beneficiário acorda o seguinte:",
    ],
    sections: [
      {
        heading: "1. Definição",
        paragraphs: () => [
          '"Informações Confidenciais" significa quaisquer dados ou informações propriedade do IBCCF e não geralmente conhecidas pelo público, seja em forma tangível ou intangível, incluindo, entre outros: o valor da liquidação, o endereço e rede da carteira de pagamento verificada, o conteúdo de qualquer correspondência de levantamento, relatórios de conformidade, documentação processual, materiais do processo e a existência e condições do presente Acordo. As Informações Confidenciais não precisam de ser novas, únicas, patenteáveis ou sujeitas a direitos de autor para serem assim designadas.',
          'A "Parte Divulgadora" é a Divisão Internacional de Aplicação do IBCCF. A "Parte Receptora" ou "Beneficiário" é a pessoa identificada na secção Partes e Dados acima, a quem foi concedido acesso a Informações Confidenciais no âmbito do processo de levantamento e liquidação do IBCCF. O Beneficiário reconhece que todas as Informações Confidenciais são propriedade do IBCCF e das suas afiliadas.',
        ],
      },
      {
        heading: "2. Divulgação e utilização de informações confidenciais",
        paragraphs: () => [
          "O Beneficiário compromete-se a utilizar as Informações Confidenciais exclusivamente no âmbito do processo de liquidação em curso e não para qualquer outro fim. A titularidade das Informações Confidenciais permanece exclusivamente no IBCCF. Toda a utilização das Informações Confidenciais pelo Beneficiário destina-se exclusivamente aos fins desta liquidação.",
          "As Informações Confidenciais não serão divulgadas a terceiros, excepto: (a) a consultores jurídicos, fiscais ou contabilísticos qualificados do Beneficiário sujeitos a dever profissional de sigilo; (b) a um regulador ou tribunal competente em virtude de uma ordem legalmente emitida, desde que o Beneficiário notifique o IBCCF por escrito o mais rapidamente possível e na medida permitida por lei; ou (c) a qualquer outra pessoa para quem o IBCCF tenha dado consentimento prévio por escrito.",
          "O Beneficiário notificará prontamente o IBCCF de qualquer utilização ou divulgação não autorizada de Informações Confidenciais e cooperará com os esforços do IBCCF para recuperar tais informações e impedir qualquer utilização não autorizada posterior. Esta cláusula não se aplica a informações que sejam ou se tornem do domínio público por razões outras que não o incumprimento deste Acordo.",
        ],
      },
      {
        heading: "3. Vigência e duração",
        paragraphs: () => [
          "Este Acordo entra em vigor com a assinatura do Beneficiário e permanece em plena vigência durante o processo de liquidação e qualquer período posterior em que o Beneficiário detenha Informações Confidenciais. Não obstante qualquer conclusão ou rescisão da liquidação, a obrigação do Beneficiário de manter a confidencialidade permanece em vigor por um período de três (3) anos a contar da data deste Acordo.",
        ],
      },
      {
        heading: "4. Devolução de informações confidenciais",
        paragraphs: () => [
          "Mediante pedido escrito do IBCCF, ou por ocasião da rescisão ou conclusão do processo de liquidação, o Beneficiário devolverá prontamente todos os materiais tangíveis que contenham Informações Confidenciais, incluindo notas, resumos, memorandos, registos, extractos ou informações derivadas, e todas as suas cópias, em formato físico, electrónico ou outro. Quando a devolução física não for praticável, o Beneficiário eliminará ou destruirá permanentemente esses materiais e fornecerá confirmação escrita da destruição a pedido do IBCCF.",
          "Os materiais pertencentes ao Beneficiário não precisam de ser devolvidos ao IBCCF, mas o Beneficiário manterá a sua estrita confidencialidade nos termos deste Acordo.",
        ],
      },
      {
        heading: "5. Carácter definitivo da liquidação",
        paragraphs: () => [
          "O Beneficiário reconhece que a liquidação indicada na secção Partes e Dados é integral e definitiva. O Beneficiário liberta irrevogavelmente o IBCCF, os seus dirigentes, directores, colaboradores e afiliadas de qualquer reclamação ulterior relacionada com o assunto subjacente, salvo fraude ou conduta dolosa descoberta após a data deste Acordo.",
          "Uma vez assinado este Acordo, o processo fica permanentemente selado no sistema IBCCF. Não podem ser efectuadas alterações adicionais ao registo do processo, salvo através do procedimento documentado de Anulação do Selo do IBCCF, registado no registo de auditoria.",
        ],
      },
      {
        heading: "6. Limitação de responsabilidade",
        paragraphs: () => [
          "O Beneficiário concorda em indemnizar e isentar de responsabilidade o IBCCF e as suas afiliadas, dirigentes, directores, colaboradores e representantes de todas as perdas, danos, litígios, reclamações, pedidos, responsabilidades, custos e despesas (directos ou indirectos), incluindo honorários jurídicos razoáveis, resultantes de qualquer incumprimento deste Acordo pelo Beneficiário, incluindo qualquer utilização ou divulgação não autorizadas de Informações Confidenciais.",
          "Esta obrigação de indemnização sobreviverá à rescisão deste Acordo e permanecerá em vigor enquanto o Beneficiário ou os seus representantes detiverem Informações Confidenciais pertencentes ao IBCCF. A responsabilidade tem início na data de assinatura e aplica-se a todas as Informações Confidenciais recebidas ou acedidas durante o processo de liquidação.",
        ],
      },
      {
        heading: "7. Impressão de integridade e registo probatório",
        paragraphs: () => [
          "Este documento é gerado em PDF cuja impressão SHA-256 é calculada no momento da assinatura. A impressão é apresentada ao Beneficiário no seu portal e armazenada juntamente com o documento assinado. Qualquer alteração futura do documento gerará uma impressão diferente, sendo portanto detectável.",
          "O documento assinado, a impressão SHA-256, a assinatura do Beneficiário através de nome escrito, a marca temporal da assinatura, o endereço IP de origem e a cadeia do agente do utilizador constituem, em conjunto, o registo probatório do presente Acordo.",
        ],
      },
      {
        heading: "8. Lei aplicável e jurisdição",
        paragraphs: (v) => [
          `Este Acordo será regido e interpretado de acordo com as leis de ${v.jurisdiction}, sem consideração às suas disposições sobre conflito de leis. Em caso de litígio relacionado com este Acordo, as partes acordam submeter-se à jurisdição não exclusiva dos tribunais competentes dessa jurisdição. Cada parte consente expressamente a essa jurisdição para a resolução de quaisquer litígios.`,
        ],
      },
      {
        heading: "9. Acordo integral",
        paragraphs: () => [
          "O presente Acordo, juntamente com o registo do processo e os documentos a que se refere, constitui o acordo integral entre as partes quanto ao encerramento do processo. Substitui todas as negociações e entendimentos anteriores sobre esta matéria. Se alguma disposição for considerada inexequível, as restantes permanecerão em pleno vigor.",
        ],
      },
    ],
    acknowledgement:
      "Li e compreendi todas as disposições do presente Acordo de Não Divulgação, Confidencialidade e Liquidação. Ao escrever o meu nome legal completo a seguir e submeter este formulário:\n\n(1) aceito as obrigações e responsabilidades estabelecidas neste Acordo;\n\n(2) reconheço que a liquidação indicada é integral e definitiva e liberto o IBCCF de quaisquer reclamações ulteriores relacionadas com o assunto subjacente;\n\n(3) compreendo que qualquer utilização indevida de Informações Confidenciais, seja intencional ou por negligência, constitui um incumprimento deste Acordo e pode expor-me a processos judiciais cíveis e à rescisão do acordo de liquidação; e\n\n(4) confirmo que a minha assinatura através de nome escrito, juntamente com a impressão SHA-256 de integridade deste documento, constitui o registo probatório vinculativo do meu reconhecimento.",
    signatureBlock: {
      signed: "Assinado (escrito)",
      typedName: "Nome escrito",
      date: "Assinado em (UTC)",
      ip: "IP de origem",
      integrityHash: "SHA-256 (este PDF)",
      note: "Esta assinatura escrita, juntamente com a impressão de integridade acima, constitui o registo probatório do presente acordo.",
      ibccfParty: "Divisão Internacional de Aplicação do IBCCF",
      recipientParty: "Beneficiário (Assinatura Digital)",
    },
  },

  // ================================================================
  // CHINESE (SIMPLIFIED) — working translation; pending legal review
  // ================================================================
  zh: {
    title: "保密、非披露与和解协议",
    subtitle: "国际区块链社区投诉论坛 — 国际执法部",
    effectiveDateLabel: (d) => `生效日期：${d}`,
    partyLabels: {
      caseRef: "案件编号",
      recipient: "受款人（法定姓名）",
      jurisdiction: "管辖司法辖区",
      settlementAmount: "和解金额",
      wallet: "已核实付款钱包",
    },
    walletFallback: "签署时未登记",
    walletNetworkSuffix: (n) => `（${n}）`,
    recitals: [
      "鉴于受款人已完成 IBCCF 的全部提款与合规流程，并已进入最终和解阶段；",
      "鉴于双方拟以带有加密完整性哈希的防篡改文件，正式记录本案件的结案事宜；并且",
      "鉴于受款人愿意确认本和解的保密性与终局性；",
      "据此，鉴于以下各项相互承诺，受款人同意如下：",
    ],
    sections: [
      {
        heading: "1. 定义",
        paragraphs: () => [
          "「保密信息」是指属于 IBCCF 所有且不为公众所知的任何数据或信息，无论以有形或无形形式呈现，包括但不限于：和解金额、经核实的付款钱包地址及网络、任何提款往来文件的内容、合规报告、程序性文件、案件档案材料，以及本协议的存在和条款。保密信息无需具有新颖性、唯一性、可专利性或可版权性，即可被指定为保密信息。",
          "「披露方」是指代表国际区块链社区投诉论坛行事的 IBCCF 国际执法部。「接收方」或「受款人」是指上述当事人与基本信息一节中所载明的个人，该人已在 IBCCF 提款与和解流程框架内获准访问保密信息。受款人确认，本协议项下披露的所有保密信息均属 IBCCF 及其关联方的专有财产。",
        ],
      },
      {
        heading: "2. 保密信息的披露与使用",
        paragraphs: () => [
          "受款人同意仅在当前和解流程的范围内使用保密信息，不得将其用于任何其他目的。保密信息的所有权专属于 IBCCF。受款人对保密信息的一切使用均应以本次和解为唯一目的。",
          "保密信息不得向任何第三方披露或提供，但以下情形除外：（a）受款人之合资格法律、税务或会计顾问，且该等顾问负有专业保密义务；（b）依据合法发出的命令或监管要求，应监管机构或有管辖权的法院的要求进行披露，前提是受款人在法律允许的范围内及时书面通知 IBCCF；或（c）IBCCF 事先书面同意的任何其他人员。",
          "受款人发现保密信息遭受任何未经授权的使用或披露时，应立即通知 IBCCF，并应与 IBCCF 充分合作，协助其追回保密信息，防止进一步的未授权使用或披露。本条款不适用于因本协议违约以外的原因而成为公开信息的内容。",
        ],
      },
      {
        heading: "3. 期限与存续",
        paragraphs: () => [
          "本协议自受款人签署之日起生效，并在和解流程持续期间及受款人持有保密信息的任何后续期间内持续有效。无论和解是否完成或终止，受款人对保密信息的保密义务应自本协议签署之日起继续有效三（3）年。",
        ],
      },
      {
        heading: "4. 保密信息的归还",
        paragraphs: () => [
          "在 IBCCF 书面要求时，或在和解流程终止或完成后，受款人应立即归还所有载有保密信息的有形材料，包括所有笔记、摘要、备忘录、记录、摘录或衍生信息及其一切副本，无论以何种物理、电子或其他存储形式。如物理归还不可行，受款人应永久删除或销毁上述所有材料，并应要求提供书面销毁确认。",
          "属于受款人的材料无需归还给 IBCCF，但受款人应依据本协议对其保持严格保密。",
        ],
      },
      {
        heading: "5. 和解的终局性",
        paragraphs: () => [
          "受款人确认，上述当事人与基本信息一节所载和解金额为完全且最终的和解。除本协议签署日之后发现的欺诈或故意不当行为外，受款人不可撤销地免除 IBCCF 及其高级职员、董事、雇员和关联方因基础事项而产生的一切后续索赔、要求或诉讼程序。",
          "本协议一经受款人签署执行，案件即在 IBCCF 系统中被永久封存。除 IBCCF 书面记录的「解除封存」程序外，不得对案件档案作出任何进一步变更，该程序本身亦将记录于审计日志中。",
        ],
      },
      {
        heading: "6. 责任限制",
        paragraphs: () => [
          "受款人特此同意就受款人违反本协议所造成的任何及一切损失、损害、诉讼、索赔、要求、责任、费用及开支（无论是直接还是间接，无论是否源于第三方索赔），包括合理的法律费用，对 IBCCF 及其关联方、高级职员、董事、雇员和代表进行赔偿并使其免受损害，包括受款人对保密信息的任何未经授权的使用或披露。",
          "此赔偿义务在本协议终止后继续有效，并在受款人或其代表持有属于 IBCCF 的任何保密信息期间持续生效。本协议项下的责任自签署之日起生效，适用于和解过程中收到或访问的所有保密信息。",
        ],
      },
      {
        heading: "7. 完整性哈希与证据记录",
        paragraphs: () => [
          "本文件以 PDF 形式生成，其 SHA-256 哈希值于签署时计算得出。该哈希值会在受款人的门户中显示，并与已签署文件一并保存。文件如有任何后续更动，将产生不同的哈希值，因而可被检测。",
          "已签署文件、SHA-256 哈希值、受款人输入的姓名签名、签署时间戳、源 IP 地址以及用户代理字符串共同构成本协议的证据记录。",
        ],
      },
      {
        heading: "8. 适用法律与管辖",
        paragraphs: (v) => [
          `本协议应受 ${v.jurisdiction} 法律管辖，并依该法律进行解释，不考虑其法律冲突规则。如因本协议产生或与本协议相关的任何争议，双方同意接受该司法辖区有管辖权法院的非排他性管辖。各方特此就任何此类争议的解决同意接受上述管辖。`,
        ],
      },
      {
        heading: "9. 完整协议",
        paragraphs: () => [
          "本协议连同案件档案及其所引述的文件，构成双方就本案件结案事宜的完整协议，并取代此前就该事项所作的一切协商与谅解。如本协议任何条款被认定不可执行，其余条款仍应完全有效。",
        ],
      },
    ],
    acknowledgement:
      "本人已阅读并理解本《保密、非披露与和解协议》的所有条款。通过在下方输入本人之法定全名并提交本表格：\n\n（1）本人同意本协议所规定的一切义务与责任；\n\n（2）本人确认上述和解为完全且最终的和解，并免除 IBCCF 因基础事项产生的一切后续索赔；\n\n（3）本人理解，任何对保密信息的滥用，无论是故意还是过失，均构成对本协议的违反，可能使本人面临民事法律诉讼并导致和解安排的终止；以及\n\n（4）本人确认，本人的输入式签名连同本文件的 SHA-256 完整性哈希，共同构成本承诺书具有约束力的证据记录。",
    signatureBlock: {
      signed: "签署（输入）",
      typedName: "输入姓名",
      date: "签署时间（UTC）",
      ip: "源 IP",
      integrityHash: "SHA-256（本 PDF）",
      note: "上述输入式签名连同上方完整性哈希，共同构成本协议的证据记录。",
      ibccfParty: "IBCCF 国际执法部",
      recipientParty: "受款人（数字签名）",
    },
  },
};

export function renderNda(vars: NdaTemplateVars): NdaRendered {
  const locale = normalizeNdaLocale(vars.locale);
  const s = STRINGS[locale];

  const walletNetwork = vars.payoutWalletNetwork
    ? s.walletNetworkSuffix(vars.payoutWalletNetwork)
    : "";
  const wallet =
    vars.payoutWalletAddress && vars.payoutWalletAddress.trim().length > 0
      ? `${vars.payoutWalletAddress.trim()}${walletNetwork}`
      : s.walletFallback;

  return {
    templateVersion: NDA_TEMPLATE_VERSION,
    locale,
    title: s.title,
    subtitle: s.subtitle,
    effectiveDateLabel: s.effectiveDateLabel(vars.effectiveDate),
    partyBlock: [
      { label: s.partyLabels.caseRef, value: vars.caseId },
      { label: s.partyLabels.recipient, value: vars.legalName },
      { label: s.partyLabels.jurisdiction, value: vars.jurisdiction },
      { label: s.partyLabels.settlementAmount, value: vars.settlementAmount },
      { label: s.partyLabels.wallet, value: wallet },
    ],
    recitals: s.recitals.slice(),
    sections: s.sections.map((sec) => ({
      heading: sec.heading,
      paragraphs: sec.paragraphs(vars),
    })),
    acknowledgement: s.acknowledgement,
    signatureBlockLabels: { ...s.signatureBlock },
  };
}
