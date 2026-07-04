import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Globe, Search, ChevronRight,
  Lock, FileText, AlertTriangle, TrendingUp, Filter,
  ArrowLeft, ChevronDown, Landmark, Database, 
  Clock, MapPin, Command, 
  Map, Network, Eye, FileSearch, ShieldAlert
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { BuildStampLine } from "@/components/BuildStampLine";
import { useTranslation } from "react-i18next";

// --- TYPES ---
interface Resource {
  name: string;
  acronym?: string;
  description: string;
  url: string;
  jurisdiction: string;
  tags: string[];
  type: "body" | "regulation" | "guidance" | "database" | "research";
  priority?: "ESSENTIAL" | "CORE" | "REFERENCE";
  lastVerified?: string;
}

// --- DATA ---
const categories = [
  {
    id: "international",
    label: "International Bodies",
    icon: Globe,
    color: "from-blue-600 to-cyan-500",
    border: "border-blue-500/30",
    bg: "bg-blue-500/10",
    textColor: "text-blue-400",
    image: "/images/legal-international.png",
    description: "Global standard-setting organizations that shape international financial regulation and anti-money laundering policy.",
    resources: [
      {
        name: "Financial Action Task Force",
        acronym: "FATF",
        description: "The global money laundering and terrorist financing watchdog. Sets international standards on AML/CFT and evaluates compliance across 200+ jurisdictions. Essential reading for all compliance professionals.",
        url: "https://www.fatf-gafi.org",
        jurisdiction: "Global",
        tags: ["AML", "CFT", "Standards", "Virtual Assets"],
        type: "body",
        priority: "ESSENTIAL",
        lastVerified: "2025-01-15"
      },
      {
        name: "Bank for International Settlements",
        acronym: "BIS",
        description: "The central bank for central banks. Publishes foundational research on crypto-asset risks, CBDC frameworks, and cross-border payment regulation. Basel Committee on Banking Supervision operates under BIS.",
        url: "https://www.bis.org",
        jurisdiction: "Global",
        tags: ["Banking", "CBDC", "Crypto-assets", "Basel"],
        type: "body",
        priority: "CORE",
        lastVerified: "2024-11-20"
      },
      {
        name: "International Monetary Fund",
        acronym: "IMF",
        description: "Provides global monetary cooperation guidance. Publishes country-level assessments, AML/CFT technical assistance, and digital currency policy papers including its Crypto Risk Classification Matrix.",
        url: "https://www.imf.org",
        jurisdiction: "Global",
        tags: ["Monetary Policy", "Crypto", "CBDC", "AML"],
        type: "body",
        priority: "CORE",
        lastVerified: "2024-12-05"
      },
      {
        name: "Financial Stability Board",
        acronym: "FSB",
        description: "Monitors and makes recommendations about the global financial system. Published comprehensive crypto-asset regulatory framework recommendations adopted by G20 jurisdictions in 2023.",
        url: "https://www.fsb.org",
        jurisdiction: "Global (G20)",
        tags: ["Crypto Regulation", "Stablecoins", "DeFi", "G20"],
        type: "body",
        priority: "ESSENTIAL",
        lastVerified: "2024-10-10"
      },
      {
        name: "International Organization of Securities Commissions",
        acronym: "IOSCO",
        description: "International body for securities regulators. Published global crypto and digital asset regulatory frameworks, DeFi guidance, and cross-border enforcement cooperation standards.",
        url: "https://www.iosco.org",
        jurisdiction: "Global",
        tags: ["Securities", "Crypto", "DeFi", "Markets"],
        type: "body",
        priority: "CORE",
        lastVerified: "2024-09-28"
      },
      {
        name: "Egmont Group of Financial Intelligence Units",
        acronym: "Egmont",
        description: "International network of 176 Financial Intelligence Units (FIUs). Facilitates information exchange on money laundering, terrorist financing, and cryptocurrency-related financial crime.",
        url: "https://egmontgroup.org",
        jurisdiction: "Global",
        tags: ["FIU", "Intelligence", "Information Sharing", "AML"],
        type: "body",
        priority: "CORE",
        lastVerified: "2025-01-02"
      },
      {
        name: "United Nations Office on Drugs and Crime",
        acronym: "UNODC",
        description: "Leads UN efforts against drugs, crime, and terrorism. Provides guidelines on cryptocurrency-related money laundering, dark web financial crimes, and asset recovery across jurisdictions.",
        url: "https://www.unodc.org",
        jurisdiction: "Global",
        tags: ["Crime", "AML", "Asset Recovery", "Dark Web"],
        type: "body",
        priority: "REFERENCE",
        lastVerified: "2024-08-15"
      },
      {
        name: "World Bank — Financial Integrity",
        acronym: "World Bank",
        description: "Provides technical assistance and research on AML/CFT compliance, anti-corruption, beneficial ownership transparency, and digital financial services regulation in developing economies.",
        url: "https://www.worldbank.org/en/topic/financialsector",
        jurisdiction: "Global",
        tags: ["AML", "Integrity", "Developing Markets", "Beneficial Ownership"],
        type: "body",
        priority: "REFERENCE",
        lastVerified: "2024-07-22"
      }
    ] as Resource[]
  },
  {
    id: "national",
    label: "National Regulators",
    icon: Landmark,
    color: "from-violet-600 to-purple-500",
    border: "border-violet-500/30",
    bg: "bg-violet-500/10",
    textColor: "text-violet-400",
    image: "/images/legal-national.png",
    description: "Key national and regional financial regulators that directly enforce cryptocurrency and AML laws.",
    resources: [
      {
        name: "Financial Crimes Enforcement Network",
        acronym: "FinCEN",
        description: "US Treasury bureau collecting and analyzing financial transactions to combat domestic and international money laundering and other financial crimes. Issues binding AML guidance for virtual asset service providers (VASPs).",
        url: "https://www.fincen.gov",
        jurisdiction: "United States",
        tags: ["AML", "BSA", "VASP", "US Law"],
        type: "body",
        priority: "ESSENTIAL",
        lastVerified: "2025-02-01"
      },
      {
        name: "Financial Conduct Authority",
        acronym: "FCA",
        description: "UK financial services regulator overseeing crypto-asset promotions, VASP registration, and AML compliance. Maintains the public register of approved and refused crypto firms operating in the UK.",
        url: "https://www.fca.org.uk",
        jurisdiction: "United Kingdom",
        tags: ["Crypto Registration", "AML", "Consumer Protection", "UK Law"],
        type: "body",
        priority: "CORE",
        lastVerified: "2024-11-10"
      },
      {
        name: "U.S. Securities and Exchange Commission",
        acronym: "SEC",
        description: "US regulator of securities markets. Has taken enforcement action on numerous cryptocurrency projects deemed unregistered securities offerings. SEC's crypto enforcement actions set global precedent.",
        url: "https://www.sec.gov/digital-assets",
        jurisdiction: "United States",
        tags: ["Securities", "Enforcement", "ICO", "Exchange Regulation"],
        type: "body",
        priority: "ESSENTIAL",
        lastVerified: "2025-01-20"
      },
      {
        name: "Commodity Futures Trading Commission",
        acronym: "CFTC",
        description: "Regulates US derivatives markets including cryptocurrency futures and swaps. Has jurisdiction over Bitcoin and Ether as commodities. Actively pursues crypto fraud and manipulation cases.",
        url: "https://www.cftc.gov/digitalassets",
        jurisdiction: "United States",
        tags: ["Derivatives", "Commodities", "BTC", "Crypto Fraud"],
        type: "body",
        priority: "CORE",
        lastVerified: "2024-10-05"
      },
      {
        name: "European Securities and Markets Authority",
        acronym: "ESMA",
        description: "EU financial markets regulator overseeing implementation of Markets in Crypto-Assets (MiCA) regulation. Coordinates supervisory convergence across EU member states for crypto-asset service providers.",
        url: "https://www.esma.europa.eu",
        jurisdiction: "European Union",
        tags: ["MiCA", "EU Law", "CASP", "Stablecoins"],
        type: "body",
        priority: "ESSENTIAL",
        lastVerified: "2025-01-10"
      },
      {
        name: "European Banking Authority",
        acronym: "EBA",
        description: "EU banking regulator publishing AML/CFT guidelines for crypto-asset issuers and service providers under MiCA, including technical standards for travel rule compliance and VASP due diligence.",
        url: "https://www.eba.europa.eu",
        jurisdiction: "European Union",
        tags: ["AML", "MiCA", "Travel Rule", "EU Law"],
        type: "body",
        priority: "CORE",
        lastVerified: "2024-12-12"
      },
      {
        name: "Office of Foreign Assets Control",
        acronym: "OFAC",
        description: "US Treasury sanctions authority. Administers economic and trade sanctions including against cryptocurrency exchanges, mixer protocols, and wallets linked to sanctioned entities or states.",
        url: "https://ofac.treasury.gov",
        jurisdiction: "United States",
        tags: ["Sanctions", "Compliance", "OFAC Lists", "Mixer Protocols"],
        type: "body",
        priority: "ESSENTIAL",
        lastVerified: "2025-02-05"
      },
      {
        name: "Monetary Authority of Singapore",
        acronym: "MAS",
        description: "Singapore's central bank and financial regulator with a progressive crypto framework under the Payment Services Act. One of the most comprehensive and clear VASP licensing regimes globally.",
        url: "https://www.mas.gov.sg/regulation/digital-payment-tokens",
        jurisdiction: "Singapore",
        tags: ["Licensing", "VASP", "PSA", "Asia-Pacific"],
        type: "body",
        priority: "CORE",
        lastVerified: "2024-09-15"
      },
      {
        name: "Financial Market Supervisory Authority",
        acronym: "FINMA",
        description: "Switzerland's financial market regulator with comprehensive DLT-specific legislation. Switzerland's 'Crypto Valley' framework and FINMA's guidance are leading models for blockchain legal classification.",
        url: "https://www.finma.ch/en/authorisation/fintech/blockchain-dlt",
        jurisdiction: "Switzerland",
        tags: ["DLT", "ICO", "Token Classification", "Switzerland"],
        type: "body",
        priority: "REFERENCE",
        lastVerified: "2024-08-30"
      }
    ] as Resource[]
  },
  {
    id: "crypto-law",
    label: "Crypto Regulations",
    icon: FileText,
    color: "from-amber-500 to-orange-500",
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    textColor: "text-amber-400",
    image: "/images/legal-crypto-law.png",
    description: "Primary legislation, regulatory guidance, and legal frameworks specifically governing cryptocurrency and digital assets.",
    resources: [
      {
        name: "EU Markets in Crypto-Assets Regulation",
        acronym: "MiCA",
        description: "The world's first comprehensive crypto-asset regulatory framework, effective 2024. Covers issuance of crypto-assets, asset-referenced tokens, e-money tokens, and CASPs operating in the EU. Available in full on EUR-Lex.",
        url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32023R1114",
        jurisdiction: "European Union",
        tags: ["MiCA", "CASP", "Stablecoins", "Full Text"],
        type: "regulation",
        priority: "ESSENTIAL",
        lastVerified: "2025-01-01"
      },
      {
        name: "FATF Guidance on Virtual Assets and VASPs",
        acronym: "FATF",
        description: "The definitive international AML/CFT guidance for virtual assets. Covers the Travel Rule for crypto transfers, risk-based supervision of VASPs, and jurisdictional implementation guidance. Updated 2023.",
        url: "https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html",
        jurisdiction: "Global",
        tags: ["Travel Rule", "VASP", "AML", "Guidance"],
        type: "guidance",
        priority: "ESSENTIAL",
        lastVerified: "2024-11-15"
      },
      {
        name: "US Bank Secrecy Act — Crypto Application",
        acronym: "BSA / FinCEN",
        description: "FinCEN's interpretive guidance applying the Bank Secrecy Act to virtual currencies. Defines money transmission, KYC/AML obligations, and SAR filing requirements for cryptocurrency businesses.",
        url: "https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-persons-administering",
        jurisdiction: "United States",
        tags: ["BSA", "KYC", "SAR", "US Law"],
        type: "regulation",
        priority: "CORE",
        lastVerified: "2024-10-20"
      },
      {
        name: "Travel Rule — FATF Recommendation 16",
        acronym: "FATF R.16",
        description: "Requires VASPs to collect and transmit originator and beneficiary information for crypto transfers above thresholds. Now implemented in EU (TFR), UK, Singapore, and other major jurisdictions.",
        url: "https://www.fatf-gafi.org/en/topics/virtual-assets.html",
        jurisdiction: "Global",
        tags: ["Travel Rule", "Wire Transfer", "VASP", "Compliance"],
        type: "regulation",
        priority: "ESSENTIAL",
        lastVerified: "2025-01-10"
      },
      {
        name: "OFAC Cryptocurrency Compliance Framework",
        acronym: "OFAC",
        description: "OFAC guidance on sanctions compliance for the virtual currency industry. Covers screening obligations, SDN list application to blockchain addresses, and enforcement priorities for crypto businesses.",
        url: "https://ofac.treasury.gov/media/913571/download?inline",
        jurisdiction: "United States",
        tags: ["Sanctions", "SDN", "Compliance", "Crypto"],
        type: "guidance",
        priority: "CORE",
        lastVerified: "2024-09-05"
      },
      {
        name: "UK Financial Services and Markets Act 2023 — Crypto",
        acronym: "FSMA 2023",
        description: "Brings cryptoassets within UK financial regulation framework. Expands FCA's regulatory perimeter to include crypto-asset activities, stablecoin issuance, and digital settlement assets.",
        url: "https://www.legislation.gov.uk/ukpga/2023/29/contents",
        jurisdiction: "United Kingdom",
        tags: ["UK Law", "Stablecoins", "DSA", "FCA"],
        type: "regulation",
        priority: "CORE",
        lastVerified: "2024-08-20"
      },
      {
        name: "Fifth EU Anti-Money Laundering Directive",
        acronym: "5AMLD",
        description: "Brought virtual currency exchanges and custodian wallet providers within the EU AML framework for the first time. Mandates KYC, suspicious transaction reporting, and registration requirements.",
        url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32018L0843",
        jurisdiction: "European Union",
        tags: ["AML", "KYC", "Exchange", "Wallet Providers"],
        type: "regulation",
        priority: "REFERENCE",
        lastVerified: "2024-07-15"
      },
      {
        name: "OECD Crypto-Asset Reporting Framework",
        acronym: "CARF",
        description: "New international tax reporting standard requiring automatic exchange of information on crypto-asset transactions between tax authorities. Adopted by 50+ countries, effective from 2026.",
        url: "https://www.oecd.org/tax/exchange-of-tax-information/crypto-asset-reporting-framework-and-amendments-to-the-common-reporting-standard.htm",
        jurisdiction: "Global (OECD)",
        tags: ["Tax", "Reporting", "CARF", "CRS"],
        type: "regulation",
        priority: "CORE",
        lastVerified: "2024-12-01"
      }
    ] as Resource[]
  },
  {
    id: "aml",
    label: "AML & Financial Crime",
    icon: ShieldAlert,
    color: "from-red-600 to-rose-500",
    border: "border-red-500/30",
    bg: "bg-red-500/10",
    textColor: "text-red-400",
    image: "/images/legal-aml.png",
    description: "Specialized resources for anti-money laundering, counter-terrorism financing, and financial crime prevention professionals.",
    resources: [
      {
        name: "Wolfsberg Group",
        acronym: "Wolfsberg",
        description: "Association of 13 global banks setting AML/KYC standards. Publishes widely adopted guidance on correspondent banking, trade finance, VASP due diligence, and sanctions screening. Crypto guidance published 2021.",
        url: "https://www.wolfsberg-principles.com",
        jurisdiction: "Global",
        tags: ["AML", "KYC", "Correspondent Banking", "Standards"],
        type: "body",
        priority: "CORE",
        lastVerified: "2024-11-25"
      },
      {
        name: "Association of Certified Anti-Money Laundering Specialists",
        acronym: "ACAMS",
        description: "World's largest financial crime prevention organization offering CAMS certification, crypto AML training, regulatory updates, and a comprehensive library of guidance documents and case studies.",
        url: "https://www.acams.org",
        jurisdiction: "Global",
        tags: ["CAMS", "Training", "Certification", "Resources"],
        type: "body",
        priority: "REFERENCE",
        lastVerified: "2025-01-05"
      },
      {
        name: "Basel AML Index",
        acronym: "Basel Institute",
        description: "Independent ranking of countries' risk of money laundering and terrorist financing. Published annually by the Basel Institute on Governance. An essential country-risk assessment tool for compliance teams.",
        url: "https://www.baselgovernance.org/basel-aml-index",
        jurisdiction: "Global",
        tags: ["Country Risk", "AML", "Index", "Compliance"],
        type: "database",
        priority: "ESSENTIAL",
        lastVerified: "2024-10-30"
      },
      {
        name: "Financial Intelligence Unit — Guidance Library",
        acronym: "FinCEN Advisories",
        description: "FinCEN's library of advisories, guidance documents, and strategic analyses covering specific financial crime typologies including crypto-related money laundering schemes and red flags.",
        url: "https://www.fincen.gov/resources/advisories",
        jurisdiction: "United States",
        tags: ["Typologies", "Red Flags", "Advisories", "SAR"],
        type: "guidance",
        priority: "CORE",
        lastVerified: "2024-09-20"
      },
      {
        name: "INTERPOL Financial Crimes",
        acronym: "INTERPOL",
        description: "INTERPOL's financial crime and anti-corruption division. Coordinates cross-border cryptocurrency fraud investigations, cybercrime-linked asset recovery, and law enforcement intelligence sharing.",
        url: "https://www.interpol.int/en/Crimes/Financial-crime",
        jurisdiction: "Global",
        tags: ["Law Enforcement", "Cross-border", "Cybercrime", "Fraud"],
        type: "body",
        priority: "CORE",
        lastVerified: "2024-08-10"
      },
      {
        name: "FATF Money Laundering Typologies",
        acronym: "FATF",
        description: "FATF's library of money laundering and terrorist financing typologies reports, including crypto-specific case studies on mixing services, DeFi exploitation, NFT laundering, and ransomware payments.",
        url: "https://www.fatf-gafi.org/en/publications/Methodsandtrends/",
        jurisdiction: "Global",
        tags: ["Typologies", "DeFi", "NFT", "Ransomware"],
        type: "research",
        priority: "ESSENTIAL",
        lastVerified: "2024-12-15"
      }
    ] as Resource[]
  },
  {
    id: "legal-databases",
    label: "Legal Databases",
    icon: Database,
    color: "from-indigo-600 to-blue-500",
    border: "border-indigo-500/30",
    bg: "bg-indigo-500/10",
    textColor: "text-indigo-400",
    image: "/images/legal-legal-databases.png",
    description: "Free and publicly accessible legal databases for researching financial regulation, case law, and treaty obligations.",
    resources: [
      {
        name: "EUR-Lex — EU Law Database",
        acronym: "EUR-Lex",
        description: "Free access to all European Union law including directives, regulations, and case law. Contains full text of MiCA, 5AMLD, 6AMLD, TFR regulation, and all crypto-related EU legislation.",
        url: "https://eur-lex.europa.eu",
        jurisdiction: "European Union",
        tags: ["EU Law", "Full Text", "Free Access", "MiCA"],
        type: "database",
        priority: "CORE",
        lastVerified: "2025-01-22"
      },
      {
        name: "United States Code — Federal Law",
        acronym: "US Code",
        description: "Complete official text of United States federal statutes. Access the Bank Secrecy Act, Securities Exchange Act, Commodity Exchange Act, and other laws applicable to cryptocurrency in the US.",
        url: "https://uscode.house.gov",
        jurisdiction: "United States",
        tags: ["US Federal Law", "BSA", "Full Text", "Free Access"],
        type: "database",
        priority: "REFERENCE",
        lastVerified: "2024-11-05"
      },
      {
        name: "Code of Federal Regulations — FinCEN Rules",
        acronym: "CFR",
        description: "Codified US federal regulations including 31 CFR Part 1022 (money services businesses) and 12 CFR Part 21 (bank AML programs). Search directly for crypto-applicable FinCEN rules.",
        url: "https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X",
        jurisdiction: "United States",
        tags: ["Regulations", "CFR", "AML", "MSB"],
        type: "database",
        priority: "REFERENCE",
        lastVerified: "2024-10-15"
      },
      {
        name: "UK Legislation — legislation.gov.uk",
        acronym: "UK Legislation",
        description: "Full text of UK Acts of Parliament and statutory instruments including the Money Laundering Regulations 2017 (amended for crypto), FSMA 2023, and all cryptoasset-related UK law.",
        url: "https://www.legislation.gov.uk",
        jurisdiction: "United Kingdom",
        tags: ["UK Law", "Full Text", "Free Access", "MLR"],
        type: "database",
        priority: "REFERENCE",
        lastVerified: "2024-09-10"
      },
      {
        name: "Law Library of Congress — Crypto Law Survey",
        acronym: "LOC",
        description: "Comprehensive comparative study of cryptocurrency regulation across 130 jurisdictions. Updated regularly. Invaluable for understanding how different countries classify and regulate digital assets.",
        url: "https://www.loc.gov/law/help/cryptocurrency/",
        jurisdiction: "Global (130+ jurisdictions)",
        tags: ["Comparative Law", "Survey", "130 Countries", "Research"],
        type: "database",
        priority: "ESSENTIAL",
        lastVerified: "2025-02-10"
      },
      {
        name: "Global Legal Monitor — Cryptocurrency",
        acronym: "LOC Monitor",
        description: "Library of Congress global legal research service tracking new laws, regulations, and court decisions on cryptocurrency worldwide. Includes news of new jurisdictional developments in near real-time.",
        url: "https://www.loc.gov/law/foreign-news/cryptocurrency/",
        jurisdiction: "Global",
        tags: ["News", "New Laws", "Real-time", "Comparative"],
        type: "database",
        priority: "CORE",
        lastVerified: "2025-01-25"
      }
    ] as Resource[]
  },
  {
    id: "research",
    label: "Research & Intelligence",
    icon: TrendingUp,
    color: "from-fuchsia-600 to-pink-500",
    border: "border-fuchsia-500/30",
    bg: "bg-fuchsia-500/10",
    textColor: "text-fuchsia-400",
    image: "/images/legal-research.png",
    description: "Blockchain analytics, crypto compliance research, and financial crime intelligence resources.",
    resources: [
      {
        name: "Chainalysis Crypto Crime Report",
        acronym: "Chainalysis",
        description: "Annual and quarterly reports on cryptocurrency-related crime including money laundering volumes, ransomware payments, scam revenue, and darknet market activity. Free access to public editions.",
        url: "https://www.chainalysis.com/reports/",
        jurisdiction: "Global",
        tags: ["Blockchain Analytics", "Crime Stats", "Annual Report", "Research"],
        type: "research",
        priority: "CORE",
        lastVerified: "2025-01-30"
      },
      {
        name: "Elliptic Intelligence Library",
        acronym: "Elliptic",
        description: "Blockchain analytics and financial crime compliance research. Publishes reports on typologies, DeFi risks, sanctions evasion techniques, and crypto threat actor profiling.",
        url: "https://www.elliptic.co/resources",
        jurisdiction: "Global",
        tags: ["Analytics", "Sanctions", "DeFi", "Threat Intelligence"],
        type: "research",
        priority: "CORE",
        lastVerified: "2024-12-20"
      },
      {
        name: "TRM Labs Regulatory Tracker",
        acronym: "TRM Labs",
        description: "Real-time global cryptocurrency regulatory tracker and blockchain intelligence research. Covers VASP licensing, Travel Rule implementation status, and jurisdiction-by-jurisdiction regulatory updates.",
        url: "https://www.trmlabs.com/resource-hub",
        jurisdiction: "Global",
        tags: ["Regulatory Tracker", "VASP", "Real-time", "Research"],
        type: "research",
        priority: "ESSENTIAL",
        lastVerified: "2025-02-05"
      },
      {
        name: "Global Sanctions Database",
        acronym: "OpenSanctions",
        description: "Open-source database of sanctioned entities including OFAC SDN list, EU sanctions, UN sanctions, and over 100 other lists. Free API access for compliance screening of crypto addresses and persons.",
        url: "https://www.opensanctions.org",
        jurisdiction: "Global",
        tags: ["Sanctions", "SDN", "Open Source", "Free Access"],
        type: "database",
        priority: "CORE",
        lastVerified: "2024-11-30"
      },
      {
        name: "Financial Stability Board — Crypto Reports",
        acronym: "FSB Research",
        description: "FSB's library of crypto-asset market surveillance reports, stablecoin assessments, DeFi policy papers, and cross-border payment research used by G20 policymakers worldwide.",
        url: "https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/crypto-assets/",
        jurisdiction: "Global",
        tags: ["Policy", "DeFi", "Stablecoins", "G20"],
        type: "research",
        priority: "REFERENCE",
        lastVerified: "2024-10-25"
      },
      {
        name: "CipherTrace Crypto Intelligence",
        acronym: "CipherTrace",
        description: "Mastercard-owned blockchain analytics firm publishing cryptocurrency anti-money laundering reports, travel rule compliance updates, and geographic risk assessments.",
        url: "https://ciphertrace.com/resources/",
        jurisdiction: "Global",
        tags: ["AML", "Intelligence", "Crime Reports", "Compliance"],
        type: "research",
        priority: "REFERENCE",
        lastVerified: "2024-09-15"
      }
    ] as Resource[]
  }
];

const allTags = ["AML", "CFT", "Crypto", "VASP", "Travel Rule", "MiCA", "Sanctions", "Stablecoins", "DeFi", "KYC", "EU Law", "US Law", "UK Law", "Securities", "Research", "Free Access"];
const jurisdictionOptions = ["Global", "United States", "European Union", "United Kingdom", "Singapore", "Switzerland"];
const urgencyOptions = ["ESSENTIAL", "CORE", "REFERENCE"];

// --- FEATURED RESOURCES ---
const featuredResources = [
  { cat: "international", idx: 0 }, // FATF
  { cat: "crypto-law", idx: 0 },    // MiCA
  { cat: "national", idx: 6 },      // OFAC
  { cat: "aml", idx: 2 },           // Basel AML Index
  { cat: "aml", idx: 5 },           // FATF Typologies
  { cat: "legal-databases", idx: 4 } // LOC Survey
];

// --- REGULATION TIMELINE ---
const timelineEvents = [
  { year: 2018, name: "5AMLD brings VASPs into AML scope", color: "bg-blue-500" },
  { year: 2019, name: "FATF Travel Rule applied to virtual assets", color: "bg-cyan-500" },
  { year: 2021, name: "FATF Virtual Assets guidance updated", color: "bg-teal-500" },
  { year: 2022, name: "OFAC sanctions crypto mixer Tornado Cash", color: "bg-red-500" },
  { year: 2023, name: "EU MiCA regulation finalized", color: "bg-indigo-500" },
  { year: 2024, name: "OECD CARF tax reporting framework adopted", color: "bg-fuchsia-500" },
  { year: 2025, name: "MiCA full implementation", color: "bg-violet-500" },
];

// --- COMPARISON TABLE DATA ---
const slugifyValue = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const comparisonData = [
  { metric: "Licensing Required", mica: "Yes", bsa: "Yes (MSB)", mlr: "Yes (FCA)", fatf: "Yes/Reg", mas: "Yes (PSA)" },
  { metric: "Travel Rule", mica: "Yes (TFR)", bsa: "Yes", mlr: "Yes", fatf: "Yes (R.16)", mas: "Yes" },
  { metric: "Stablecoin Rules", mica: "Strict", bsa: "Partial", mlr: "Pending", fatf: "Covered", mas: "Strict" },
  { metric: "DeFi Covered", mica: "Partial", bsa: "Case-by-case", mlr: "Consulting", fatf: "If controlled", mas: "Consulting" },
  { metric: "NFT Coverage", mica: "No (mostly)", bsa: "If money", mlr: "If regulated", fatf: "If payment", mas: "If DPT" },
  { metric: "Enforcement", mica: "High", bsa: "Very High", mlr: "High", fatf: "Evaluations", mas: "High" },
];

// --- COMPONENTS ---

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

const _stagger = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

function ResourceCard({ resource, catId, idx, catColor, catBorder, catText }: {
  resource: Resource;
  catId: string;
  idx: number;
  catColor: string;
  catBorder: string;
  catBg: string;
  catText: string;
}) {
  const { t } = useTranslation("legal");

  const priorityColors = {
    ESSENTIAL: "bg-red-500/20 text-red-400 border-red-500/30",
    CORE: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    REFERENCE: "bg-slate-500/20 text-slate-400 border-slate-500/30"
  };

  const translatedDescription = t(`resources.${catId}.${idx}.description`, { defaultValue: resource.description });
  const translatedJurisdiction = t(`jurisdictions.${resource.jurisdiction}`, { defaultValue: resource.jurisdiction });
  const translatedPriority = resource.priority ? t(`urgency.${resource.priority}`, { defaultValue: resource.priority }) : undefined;

  // Generate bullet points from translated description. Use a locale-aware
  // sentence split that handles CJK punctuation (。！？) alongside Latin
  // punctuation so non-English bullets render cleanly.
  const sentences = translatedDescription
    .split(/(?:[.!?]+\s+|[。！？]+)/)
    .map(s => s.trim())
    .filter(s => s.length > 10)
    .slice(0, 3);
  const bullets = sentences.length > 1 ? sentences : [translatedDescription];

  return (
    <motion.a
      href={resource.url}
      target="_blank"
      rel="noopener noreferrer"
      variants={fadeIn}
      whileHover="hover"
      className={`group block rounded-xl border ${catBorder} bg-[#020817]/80 backdrop-blur-sm p-0 shadow-lg hover:shadow-2xl transition-all duration-300 relative overflow-hidden h-full flex flex-col`}
    >
      <div className={`absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b ${catColor} opacity-80 group-hover:opacity-100 transition-opacity`} />
      <div className={`absolute inset-0 bg-gradient-to-b from-transparent to-${catColor.split(' ')[0].replace('from-', '')}/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />

      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
             <div className="flex flex-wrap items-center gap-2 mb-2">
                {resource.priority && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-widest ${priorityColors[resource.priority]}`}>
                    {translatedPriority}
                  </span>
                )}
                <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {translatedJurisdiction}
                </span>
             </div>
             
             <div className="flex items-baseline gap-3">
               {resource.acronym && (
                 <span className={`text-xl font-black ${catText} tracking-tight shrink-0`}>
                   {resource.acronym}
                 </span>
               )}
               <h3 className="text-base font-bold text-white group-hover:text-blue-300 transition-colors leading-tight">
                 {resource.name}
               </h3>
             </div>
          </div>
        </div>

        <div className="flex-1">
          <ul className="space-y-2 mb-4">
            {bullets.map((bullet, idx) => (
              <li key={idx} className="text-sm text-slate-300 leading-snug flex items-start gap-2">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-gradient-to-br ${catColor}`} />
                <span>{bullet}{bullet.endsWith('.') ? '' : '.'}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-4 border-t border-white/5 flex items-center justify-between gap-2 mt-auto">
          <div className="flex flex-wrap gap-1.5">
            {resource.tags.slice(0, 2).map(tag => (
              <span key={tag} className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium uppercase tracking-wider">
                {t(`tags.${tag}`, { defaultValue: tag })}
              </span>
            ))}
            {resource.tags.length > 2 && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-500 font-medium">
                +{resource.tags.length - 2}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
             {resource.lastVerified && (
               <span className="text-[10px] text-slate-500 font-mono hidden sm:block">
                 {t("card.verified")} {resource.lastVerified}
               </span>
             )}
             <motion.div 
               variants={{ hover: { x: 5, color: '#fff' } }}
               className="flex items-center text-xs font-bold uppercase tracking-wider text-slate-400"
             >
               {t("card.open")} <ChevronRight className="w-4 h-4 ml-1" />
             </motion.div>
          </div>
        </div>
      </div>
    </motion.a>
  );
}

export default function LegalResourcesPage() {
  const { t } = useTranslation("legal");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, _setActiveCategory] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeUrgency, setActiveUrgency] = useState<string | null>(null);
  const [activeJurisdiction, setActiveJurisdiction] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>("international");

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleTag = (tag: string) => {
    setActiveTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const _totalResources = categories.reduce((acc, cat) => acc + cat.resources.length, 0);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return categories
      .filter(cat => !activeCategory || cat.id === activeCategory)
      .map(cat => ({
        ...cat,
        resources: cat.resources
          .map((r, originalIdx) => ({ r, originalIdx }))
          .filter(({ r, originalIdx }) => {
            const translatedDesc = t(`resources.${cat.id}.${originalIdx}.description`, { defaultValue: r.description }).toLowerCase();
            const translatedJuris = t(`jurisdictions.${r.jurisdiction}`, { defaultValue: r.jurisdiction }).toLowerCase();
            const translatedTags = r.tags.map(tag => t(`tags.${tag}`, { defaultValue: tag }).toLowerCase());

            const matchesSearch = !q ||
              r.name.toLowerCase().includes(q) ||
              r.description.toLowerCase().includes(q) ||
              translatedDesc.includes(q) ||
              r.acronym?.toLowerCase().includes(q) ||
              r.tags.some(tag => tag.toLowerCase().includes(q)) ||
              translatedTags.some(tag => tag.includes(q)) ||
              translatedJuris.includes(q);

            const matchesTags = activeTags.length === 0 ||
              activeTags.every(tag => r.tags.some(rt => rt.toLowerCase().includes(tag.toLowerCase())));

            const matchesUrgency = !activeUrgency || r.priority === activeUrgency;
            const matchesJurisdiction = !activeJurisdiction || r.jurisdiction.includes(activeJurisdiction);

            return matchesSearch && matchesTags && matchesUrgency && matchesJurisdiction;
          })
      }))
      .filter(cat => cat.resources.length > 0);
  }, [searchQuery, activeCategory, activeTags, activeUrgency, activeJurisdiction, t]);

  const totalFiltered = filteredCategories.reduce((acc, cat) => acc + cat.resources.length, 0);
  const isFiltered = searchQuery || activeCategory || activeTags.length > 0 || activeUrgency || activeJurisdiction;

  const featured = featuredResources.map(f => {
    const cat = categories.find(c => c.id === f.cat)!;
    return { resource: cat.resources[f.idx], cat, idx: f.idx };
  });

  return (
    <div className="min-h-screen bg-[#020817] font-sans selection:bg-blue-500/30 selection:text-blue-200">

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-[#020817]/90 backdrop-blur-xl">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-blue-900 rounded border border-blue-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.3)]">
                <Shield className="h-4 w-4 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-white tracking-wider leading-none">{t("header.brand")}</span>
                <span className="text-[8px] text-slate-400 uppercase tracking-widest">{t("header.subtitle")}</span>
              </div>
            </Link>

            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white hover:bg-slate-800 text-xs uppercase tracking-wider font-bold">
                  <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                  {t("back")}
                </Button>
              </Link>
              <div className="w-px h-4 bg-slate-800" />
              <Link href="/verify">
                <Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white rounded text-xs uppercase tracking-wider font-bold shadow-[0_0_15px_rgba(37,99,235,0.3)] border border-blue-500">
                  <Lock className="w-3 h-3 mr-1.5" />
                  {t("header.accessPortal")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
      {/* Hero Section (Parallax & Dramatic) */}
      <div className="relative h-[60vh] min-h-[500px] flex items-center justify-center overflow-hidden border-b border-slate-800">
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/images/legal-hero.png)', backgroundAttachment: 'fixed' }}
        />
        <div className="absolute inset-0 bg-[#020817]/80 backdrop-blur-[2px]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#020817] via-transparent to-transparent" />
        
        {/* Live Status Indicator */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 bg-slate-900/60 backdrop-blur-md border border-slate-700/50 rounded-full py-1.5 px-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="text-[10px] font-bold text-white uppercase tracking-widest">{t("hero.liveStatus")}</span>
          </div>
          <div className="w-px h-3 bg-slate-700" />
          <div className="flex items-center gap-3 text-[10px] font-medium text-slate-300">
             <span className="text-cyan-400">{t("hero.fatf")}</span>
             <span className="text-amber-400">{t("hero.mica")}</span>
             <span className="text-blue-400">{t("hero.basel")}</span>
          </div>
        </div>

        <div className="relative z-10 text-center max-w-4xl px-4">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
            <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter mb-6 uppercase" style={{ textShadow: '0 10px 30px rgba(0,0,0,0.8)' }}>
              {t("hero.titlePart1")} <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">{t("hero.titlePart2")}</span>
            </h1>
            <p className="text-lg md:text-xl text-slate-300 font-medium max-w-2xl mx-auto leading-relaxed border-l-2 border-blue-500 pl-6 text-left bg-slate-900/40 p-4 backdrop-blur-sm rounded-r-lg">
              {t("hero.subtitle")}
            </p>
          </motion.div>
        </div>
      </div>

      {/* Regulation Timeline (Horizontal Scroll) */}
      <div className="bg-[#040d21] border-b border-slate-800 py-6 overflow-hidden relative">
         <div className="max-w-[1400px] mx-auto px-4 flex items-center">
            <div className="shrink-0 flex items-center gap-2 mr-8">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">{t("timeline.label")}</span>
            </div>
            <div className="flex-1 overflow-x-auto hide-scrollbar pb-2">
               <div className="flex items-center gap-8 min-w-max px-2">
                  {timelineEvents.map((event, i) => (
                    <motion.div 
                      key={event.year}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-center gap-3 relative group"
                    >
                       <div className={`w-3 h-3 rounded-full ${event.color} shadow-[0_0_10px_currentColor]`} />
                       <div className="flex flex-col">
                          <span className="text-white font-bold font-mono text-sm">{event.year}</span>
                          <span className="text-slate-400 text-xs whitespace-nowrap">{t(`timeline.events.${event.year}`, event.name)}</span>
                       </div>
                       {i < timelineEvents.length - 1 && (
                         <div className="w-12 h-px bg-slate-800 ml-4" />
                       )}
                    </motion.div>
                  ))}
               </div>
            </div>
         </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
        
        {/* Jurisdiction Coverage Map & Quick Reference */}
        <div className="grid lg:grid-cols-3 gap-6 mb-16">
          {/* Stylized Map Area */}
          <div className="lg:col-span-1 rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden relative group p-6 flex flex-col">
             <div className="flex items-center gap-2 mb-6">
                <Map className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-bold text-white tracking-wide">{t("coverage.title")}</h3>
             </div>
             
             <div className="flex-1 flex flex-col justify-center gap-4 relative">
                {/* Abstract CSS Grid Map representation */}
                <div className="grid grid-cols-6 gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                   {Array.from({ length: 24 }).map((_, i) => {
                     // create an abstract map pattern
                     let color = "bg-slate-800";
                     if ([2, 3, 8, 9, 14].includes(i)) color = "bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]"; // Comprehensive
                     else if ([4, 10, 11, 16, 22].includes(i)) color = "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"; // Emerging
                     else if ([12, 13, 15, 18, 19, 20].includes(i)) color = "bg-slate-600"; // Developing
                     
                     return <div key={i} className={`h-8 rounded-sm ${color} transition-colors duration-500`} />;
                   })}
                </div>
                
                <div className="mt-4 space-y-2">
                   <div className="flex items-center justify-between text-xs">
                     <span className="flex items-center gap-2 text-slate-300"><div className="w-2 h-2 bg-cyan-500 rounded-full"/> {t("coverage.comprehensive")}</span>
                     <span className="text-slate-500">{t("coverage.comprehensiveRegions")}</span>
                   </div>
                   <div className="flex items-center justify-between text-xs">
                     <span className="flex items-center gap-2 text-slate-300"><div className="w-2 h-2 bg-amber-500 rounded-full"/> {t("coverage.emerging")}</span>
                     <span className="text-slate-500">{t("coverage.emergingRegions")}</span>
                   </div>
                   <div className="flex items-center justify-between text-xs">
                     <span className="flex items-center gap-2 text-slate-300"><div className="w-2 h-2 bg-slate-600 rounded-full"/> {t("coverage.developing")}</span>
                     <span className="text-slate-500">{t("coverage.developingRegions")}</span>
                   </div>
                </div>
             </div>
          </div>

          {/* Quick Reference Table */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden flex flex-col">
             <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-[#020817]/50">
               <div className="flex items-center gap-2">
                 <Network className="w-5 h-5 text-fuchsia-400" />
                 <h3 className="text-lg font-bold text-white tracking-wide">{t("comparison.title")}</h3>
               </div>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full text-left border-collapse min-w-[600px]">
                 <thead>
                   <tr>
                     <th className="p-4 border-b border-slate-800 text-xs font-bold text-slate-400 uppercase tracking-wider bg-slate-900/80 sticky left-0 z-10 backdrop-blur-md">{t("comparison.metric")}</th>
                     <th className="p-4 border-b border-slate-800 text-xs font-bold text-cyan-400 uppercase tracking-wider">MiCA (EU)</th>
                     <th className="p-4 border-b border-slate-800 text-xs font-bold text-blue-400 uppercase tracking-wider">BSA (US)</th>
                     <th className="p-4 border-b border-slate-800 text-xs font-bold text-purple-400 uppercase tracking-wider">MLR (UK)</th>
                     <th className="p-4 border-b border-slate-800 text-xs font-bold text-amber-400 uppercase tracking-wider">FATF</th>
                     <th className="p-4 border-b border-slate-800 text-xs font-bold text-rose-400 uppercase tracking-wider">PSA (SG)</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-800/50">
                   {comparisonData.map((row, i) => (
                     <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                       <td className="p-4 text-sm font-medium text-slate-300 bg-slate-900/90 sticky left-0 z-10 backdrop-blur-md">{t(`comparison.metrics.${row.metric}`, row.metric)}</td>
                       <td className="p-4 text-sm text-slate-400">{t(`comparison.values.${slugifyValue(row.mica)}`, { defaultValue: row.mica })}</td>
                       <td className="p-4 text-sm text-slate-400">{t(`comparison.values.${slugifyValue(row.bsa)}`, { defaultValue: row.bsa })}</td>
                       <td className="p-4 text-sm text-slate-400">{t(`comparison.values.${slugifyValue(row.mlr)}`, { defaultValue: row.mlr })}</td>
                       <td className="p-4 text-sm text-slate-400">{t(`comparison.values.${slugifyValue(row.fatf)}`, { defaultValue: row.fatf })}</td>
                       <td className="p-4 text-sm text-slate-400">{t(`comparison.values.${slugifyValue(row.mas)}`, { defaultValue: row.mas })}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
          </div>
        </div>

        {/* Featured Resources Horizontal Strip */}
        <div className="mb-16">
           <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded border border-blue-500/30 bg-blue-500/10 flex items-center justify-center">
                 <Eye className="w-4 h-4 text-blue-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">{t("featured.title")}</h2>
           </div>
           
           <div className="flex gap-6 overflow-x-auto pb-6 hide-scrollbar snap-x">
              {featured.map(({ resource, cat, idx }, i) => (
                 <div key={i} className="min-w-[320px] max-w-[320px] snap-start">
                   <ResourceCard 
                     resource={resource} 
                     catId={cat.id}
                     idx={idx}
                     catColor={cat.color} 
                     catBorder={cat.border} 
                     catBg={cat.bg} 
                     catText={cat.textColor} 
                   />
                 </div>
              ))}
           </div>
        </div>

        {/* Search & Filtering Command Center */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 mb-12 shadow-xl backdrop-blur-md">
           <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1">
                 <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <Input
                      id="search-input"
                      placeholder={t("search.placeholder")}
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="pl-12 pr-16 h-14 rounded-xl border-slate-700 bg-slate-800/50 text-white placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-blue-500 text-lg shadow-inner"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-50">
                       <Command className="w-4 h-4" />
                       <span className="text-xs font-bold font-mono">K</span>
                    </div>
                 </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-4">
                 <div className="flex flex-col gap-2">
                   <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{t("search.urgency")}</span>
                   <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
                     {["All", ...urgencyOptions].map(opt => (
                       <button
                         key={opt}
                         onClick={() => setActiveUrgency(opt === "All" ? null : opt)}
                         className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                           (opt === "All" && !activeUrgency) || opt === activeUrgency
                             ? "bg-slate-700 text-white shadow"
                             : "text-slate-400 hover:text-white"
                         }`}
                       >
                         {t(`urgency.${opt}`, opt)}
                       </button>
                     ))}
                   </div>
                 </div>

                 <div className="flex flex-col gap-2">
                   <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{t("search.jurisdiction")}</span>
                   <select 
                     className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]"
                     value={activeJurisdiction || ""}
                     onChange={(e) => setActiveJurisdiction(e.target.value || null)}
                   >
                     <option value="">{t("search.allRegions")}</option>
                     {jurisdictionOptions.map(opt => (
                       <option key={opt} value={opt}>{t(`jurisdictions.${opt}`, { defaultValue: opt })}</option>
                     ))}
                   </select>
                 </div>
              </div>
           </div>

           {/* Tags */}
           <div className="mt-6 pt-6 border-t border-slate-800 flex flex-wrap gap-2">
             <span className="flex items-center gap-1.5 text-xs text-slate-500 font-bold uppercase tracking-wider mr-2 self-center">
               <Filter className="w-3.5 h-3.5" />
               {t("search.topics")}
             </span>
             {allTags.map(tag => (
               <button
                 key={tag}
                 onClick={() => toggleTag(tag)}
                 className={`text-xs px-3 py-1 rounded-full font-medium transition-all border ${
                   activeTags.includes(tag)
                     ? "bg-blue-600 text-white border-blue-500 shadow-[0_0_10px_rgba(37,99,235,0.4)]"
                     : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                 }`}
               >
                 {t(`tags.${tag}`, { defaultValue: tag })}
               </button>
             ))}
             {(activeTags.length > 0 || activeUrgency || activeJurisdiction || searchQuery) && (
               <button onClick={() => { setActiveTags([]); setActiveUrgency(null); setActiveJurisdiction(null); setSearchQuery(""); }} className="text-xs px-3 py-1 rounded-full border border-red-900/50 text-red-400 font-medium hover:bg-red-900/20 transition-colors ml-auto">
                 {t("search.clear")}
               </button>
             )}
           </div>
        </div>

        {/* Results Counter */}
        <AnimatePresence mode="wait">
          <motion.div 
            key={totalFiltered}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 flex items-center gap-3"
          >
             <div className="px-3 py-1 rounded bg-blue-900/30 border border-blue-500/20 text-blue-400 font-mono text-sm font-bold">
               {totalFiltered}
             </div>
             <span className="text-slate-400 text-sm font-medium uppercase tracking-wider">{t("matchCount")}</span>
          </motion.div>
        </AnimatePresence>

        {/* Full Directory Accordion */}
        <div className="space-y-12">
          {filteredCategories.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
              <FileSearch className="w-16 h-16 text-slate-700 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">{t("noResults.title")}</h3>
              <p className="text-slate-400 text-sm">{t("noResults.subtitle")}</p>
            </div>
          ) : (
            filteredCategories.map((cat) => {
              const isExpanded = expandedCategory === cat.id || isFiltered;
              return (
                <motion.div
                  key={cat.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  className={`rounded-2xl border ${cat.border} bg-[#020817] overflow-hidden shadow-2xl`}
                >
                  {/* Cinematic Category Banner */}
                  <div 
                    className="relative h-48 md:h-56 cursor-pointer group"
                    onClick={() => setExpandedCategory(isExpanded && expandedCategory === cat.id ? null : cat.id)}
                  >
                    <div 
                      className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
                      style={{ backgroundImage: `url(${cat.image})` }}
                    />
                    <div className={`absolute inset-0 bg-gradient-to-r ${cat.color} mix-blend-multiply opacity-60`} />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#020817] via-[#020817]/80 to-transparent" />
                    
                    <div className="absolute inset-0 p-6 md:p-8 flex flex-col justify-end">
                       <div className="flex items-end justify-between gap-4">
                          <div className="flex items-center gap-4">
                             <div className={`w-14 h-14 rounded-xl bg-[#020817]/80 backdrop-blur-md border ${cat.border} flex items-center justify-center shadow-2xl`}>
                               <cat.icon className={`w-7 h-7 ${cat.textColor}`} />
                             </div>
                             <div>
                               <h2 className="text-3xl font-black text-white tracking-tight drop-shadow-lg">{t(`categories.${cat.id}.label`, cat.label)}</h2>
                               <p className="text-slate-300 font-medium mt-1 max-w-2xl text-sm drop-shadow line-clamp-1">
                                 {t(`categories.${cat.id}.description`, cat.description)}
                               </p>
                             </div>
                          </div>
                          
                          <div className="flex flex-col items-end gap-3 shrink-0">
                             <span className={`text-sm font-bold px-3 py-1 rounded-full bg-[#020817]/80 backdrop-blur text-white border ${cat.border} shadow-lg`}>
                               {cat.resources.length} {t("entries")}
                             </span>
                             <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center group-hover:bg-white/20 transition-colors border border-white/10">
                               <ChevronDown className={`w-5 h-5 text-white transition-transform duration-500 ${isExpanded ? 'rotate-180' : ''}`} />
                             </div>
                          </div>
                       </div>
                    </div>
                  </div>

                  {/* Resources Grid */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="overflow-hidden bg-slate-900/20"
                      >
                        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6 p-6 md:p-8">
                          {cat.resources.map(({ r: resource, originalIdx }) => (
                            <ResourceCard
                              key={resource.url}
                              resource={resource}
                              catId={cat.id}
                              idx={originalIdx}
                              catColor={cat.color}
                              catBorder={cat.border}
                              catBg={cat.bg}
                              catText={cat.textColor}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })
          )}
        </div>

      </div>

      {/* Footer CTA Section (3-Panel) */}
      <div className="border-t border-slate-800 bg-[#010816] mt-20 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
           <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-1/2 bg-blue-900/10 blur-3xl rounded-[100%]" />
        </div>
        
        <div className="max-w-[1400px] mx-auto px-4 py-16 lg:py-24">
           <div className="text-center max-w-2xl mx-auto mb-16 relative z-10">
              <h2 className="text-3xl md:text-4xl font-black text-white mb-4">{t("footer.title")}</h2>
              <p className="text-slate-400">{t("footer.subtitle")}</p>
           </div>
           
           <div className="grid md:grid-cols-3 gap-6 relative z-10">
              {/* Panel 1 */}
              <Link href="/request-access" className="group block h-full">
                 <div className="h-full rounded-2xl border border-red-500/20 bg-gradient-to-b from-slate-900 to-slate-900/50 p-8 hover:border-red-500/50 hover:bg-red-500/5 transition-all duration-300">
                    <div className="w-12 h-12 rounded-lg bg-red-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-red-500/20">
                       <AlertTriangle className="w-6 h-6 text-red-500" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-3">{t("footer.reportTitle")}</h3>
                    <p className="text-sm text-slate-400 mb-8">{t("footer.reportDesc")}</p>
                    <div className="flex items-center text-red-400 font-bold text-sm tracking-wider uppercase group-hover:translate-x-2 transition-transform">
                       {t("footer.reportCta")} <ArrowRight className="w-4 h-4 ml-2" />
                    </div>
                 </div>
              </Link>
              
              {/* Panel 2 */}
              <Link href="/community" className="group block h-full">
                 <div className="h-full rounded-2xl border border-blue-500/20 bg-gradient-to-b from-slate-900 to-slate-900/50 p-8 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all duration-300">
                    <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-blue-500/20">
                       <Network className="w-6 h-6 text-blue-500" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-3">{t("footer.intelTitle")}</h3>
                    <p className="text-sm text-slate-400 mb-8">{t("footer.intelDesc")}</p>
                    <div className="flex items-center text-blue-400 font-bold text-sm tracking-wider uppercase group-hover:translate-x-2 transition-transform">
                       {t("footer.intelCta")} <ArrowRight className="w-4 h-4 ml-2" />
                    </div>
                 </div>
              </Link>
              
              {/* Panel 3 */}
              <Link href="/verify" className="group block h-full">
                 <div className="h-full rounded-2xl border border-cyan-500/20 bg-gradient-to-b from-slate-900 to-slate-900/50 p-8 hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all duration-300">
                    <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 border border-cyan-500/20">
                       <Lock className="w-6 h-6 text-cyan-500" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-3">{t("footer.portalTitle")}</h3>
                    <p className="text-sm text-slate-400 mb-8">{t("footer.portalDesc")}</p>
                    <div className="flex items-center text-cyan-400 font-bold text-sm tracking-wider uppercase group-hover:translate-x-2 transition-transform">
                       {t("footer.portalCta")} <ArrowRight className="w-4 h-4 ml-2" />
                    </div>
                 </div>
              </Link>
           </div>
        </div>

        {/* Final Disclaimer Bar */}
        <div className="border-t border-slate-800 py-6 px-4">
           <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 opacity-50">
                 <Shield className="w-4 h-4 text-white" />
                 <span className="text-xs text-white font-bold tracking-widest uppercase">{t("footer.division")}</span>
              </div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest text-center">
                 {t("footer.disclaimer")}
              </p>
              <BuildStampLine className="text-slate-500" />
           </div>
        </div>
      </div>
      </main>
      
    </div>
  );
}

// ArrowRight icon for the CTA panels
function ArrowRight(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
