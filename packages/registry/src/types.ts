/**
 * @agentforge-sdlc/registry
 * All types for the harness registry and ecosystem layer.
 */

// ─── Registry entry types ─────────────────────────────────────────────────────

export type RegistryTier = 'tier1' | 'tier2' | 'tier3';

export type RegistryEntryType =
  | 'harness-template'      // complete project harness starter
  | 'db-adapter'            // database repository adapter
  | 'pipeline-adapter'      // CI/CD system adapter
  | 'scanner-interpreter'   // enterprise security scanner interpreter
  | 'monitoring-adapter'    // monitoring platform adapter
  | 'golden-principle-pack' // compliance framework rule set

export type RegistryEntryStatus =
  | 'active'
  | 'deprecated'
  | 'superseded';

// ─── Registry entry ───────────────────────────────────────────────────────────

export interface RegistryEntry {
  id: string;
  slug: string;             // URL-safe identifier e.g. 'corporate-ops-web-mobile'
  name: string;             // human-readable name
  description: string;
  type: RegistryEntryType;
  tier: RegistryTier;
  status: RegistryEntryStatus;
  version: string;          // semver
  author: RegistryAuthor;
  source: RegistrySource;
  metadata: RegistryMetadata;
  stats: RegistryStats;
  badges: RegistryBadge[];
  createdAt: Date;
  updatedAt: Date;
  verifiedAt: Date | null;  // when maintainer verified (tier2+)
  promotedAt: Date | null;  // when promoted to current tier
}

export interface RegistryAuthor {
  name: string;
  email: string;
  organisation?: string;
  githubHandle?: string;
}

export interface RegistrySource {
  gitUrl: string;           // source repository URL
  gitRef: string;           // tag or commit SHA
  entryPath: string;        // path within the repo e.g. 'templates/corporate-ops'
  checksumSha256: string;   // SHA256 of the entry content at gitRef
}

export interface RegistryMetadata {
  targetDomains: string[];          // e.g. ['corporate-ops', 'hr', 'finance']
  supportedStacks: StackTag[];
  complianceFrameworks: string[];   // e.g. ['GDPR', 'SOC2', 'HIPAA']
  minPlatformVersion: string;       // semver
  tags: string[];
  screenshots: string[];            // URLs to screenshots/previews
}

export type StackTag =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'react'
  | 'vue'
  | 'angular'
  | 'react-native'
  | 'postgres'
  | 'oracle'
  | 'mssql'
  | 'mysql';

export interface RegistryStats {
  downloads: number;
  activeProjects: number;    // projects currently using this entry
  rating: number | null;     // 1-5, null if < 3 ratings
  ratingCount: number;
}

export interface RegistryBadge {
  type: 'verified' | 'security-reviewed' | 'community-pick' | 'deprecated';
  label: string;
  awardedAt: Date;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface RegistrySearchParams {
  query?: string;
  type?: RegistryEntryType;
  tier?: RegistryTier;
  tags?: string[];
  stack?: StackTag;
  complianceFramework?: string;
  minRating?: number;
  limit?: number;
  offset?: number;
}

export interface RegistrySearchResult {
  entries: RegistryEntry[];
  total: number;
  query: RegistrySearchParams;
}

// ─── Pull request ─────────────────────────────────────────────────────────────

export interface RegistryPullRequest {
  entryId: string;
  correlationId: string;
  tier: RegistryTier;
  targetPath: string;        // local path to install to
  status: 'pending' | 'downloading' | 'validating' | 'installed' | 'failed';
  installedAt: Date | null;
}

// ─── Submission (contributing to the registry) ───────────────────────────────

export interface RegistrySubmission {
  id: string;
  type: RegistryEntryType;
  name: string;
  description: string;
  gitUrl: string;
  gitRef: string;
  entryPath: string;
  submittedBy: RegistryAuthor;
  targetTier: 'tier2' | 'tier3';  // submissions always go to tier2 or tier3
  automatedChecks: AutomatedCheckResult[];
  reviewStatus: 'pending' | 'under-review' | 'approved' | 'rejected';
  reviewNotes: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
}

export interface AutomatedCheckResult {
  checkName: string;
  passed: boolean;
  message: string;
  runAt: Date;
}

// ─── Promotion ────────────────────────────────────────────────────────────────

export interface PromotionRequest {
  entryId: string;
  fromTier: RegistryTier;
  toTier: RegistryTier;
  requestedBy: string;       // maintainer user ID
  criteria: PromotionCriteria;
  approvedBy: string[];      // maintainer IDs who approved
  status: 'proposed' | 'under-review' | 'approved' | 'rejected';
  notes: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface PromotionCriteria {
  automatedChecksPassed: boolean;
  minimumDownloads: number;
  minimumActiveProjects: number;
  minimumRating: number;
  productionProjects: number;   // must be 3+ for tier1 promotion
  maintainerReviewComplete: boolean;
  integrationTestsPassed: boolean;
}
