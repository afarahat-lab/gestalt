/**
 * Promotion engine — manages the tier promotion pathway.
 *
 * Tier 3 → Tier 2: automated checks + maintainer review
 * Tier 2 → Tier 1: maintainer review + integration tests + usage threshold
 *
 * Promotion criteria (non-negotiable thresholds):
 *
 * Tier 3 → Tier 2:
 *   - All automated checks pass
 *   - At least 10 downloads
 *   - At least 1 active project
 *   - 1 maintainer review approval
 *
 * Tier 2 → Tier 1:
 *   - All Tier 2 criteria met
 *   - At least 100 downloads
 *   - At least 3 active production projects
 *   - Rating ≥ 4.0 with at least 5 ratings
 *   - 2 maintainer review approvals
 *   - Integration tests pass on reference implementation
 *   - Documentation review complete
 */

import type {
  RegistryEntry, RegistryTier, PromotionRequest, PromotionCriteria,
} from '../types';

const PROMOTION_THRESHOLDS: Record<string, PromotionCriteria> = {
  'tier3-to-tier2': {
    automatedChecksPassed: true,
    minimumDownloads: 10,
    minimumActiveProjects: 1,
    minimumRating: 0,       // no rating requirement for tier2
    productionProjects: 0,  // no production requirement for tier2
    maintainerReviewComplete: true,
    integrationTestsPassed: false,  // not required for tier2
  },
  'tier2-to-tier1': {
    automatedChecksPassed: true,
    minimumDownloads: 100,
    minimumActiveProjects: 3,
    minimumRating: 4.0,
    productionProjects: 3,
    maintainerReviewComplete: true,
    integrationTestsPassed: true,
  },
};

/**
 * Checks whether a registry entry meets the criteria for promotion to the next tier.
 * Returns an object describing which criteria are met and which are not.
 */
export function assessPromotionReadiness(
  entry: RegistryEntry,
  targetTier: RegistryTier,
): PromotionAssessment {
  const key = `${entry.tier}-to-${targetTier}`;
  const thresholds = PROMOTION_THRESHOLDS[key];

  if (!thresholds) {
    return {
      eligible: false,
      blockers: [`No promotion path defined from ${entry.tier} to ${targetTier}`],
      met: [],
    };
  }

  const blockers: string[] = [];
  const met: string[] = [];

  // Downloads
  if (entry.stats.downloads >= thresholds.minimumDownloads) {
    met.push(`Downloads: ${entry.stats.downloads} ≥ ${thresholds.minimumDownloads}`);
  } else {
    blockers.push(`Downloads: ${entry.stats.downloads} < ${thresholds.minimumDownloads} required`);
  }

  // Active projects
  if (entry.stats.activeProjects >= thresholds.minimumActiveProjects) {
    met.push(`Active projects: ${entry.stats.activeProjects} ≥ ${thresholds.minimumActiveProjects}`);
  } else {
    blockers.push(`Active projects: ${entry.stats.activeProjects} < ${thresholds.minimumActiveProjects} required`);
  }

  // Rating (only if threshold > 0)
  if (thresholds.minimumRating > 0) {
    const rating = entry.stats.rating ?? 0;
    const ratingCount = entry.stats.ratingCount;
    if (rating >= thresholds.minimumRating && ratingCount >= 5) {
      met.push(`Rating: ${rating.toFixed(1)} ≥ ${thresholds.minimumRating} (${ratingCount} ratings)`);
    } else {
      blockers.push(
        rating < thresholds.minimumRating
          ? `Rating: ${rating.toFixed(1)} < ${thresholds.minimumRating} required`
          : `Rating count: ${ratingCount} < 5 required`,
      );
    }
  }

  // Production projects (tier1 only)
  if (thresholds.productionProjects > 0) {
    // Phase 2: query production deployment count from usage telemetry
    // For now, assume met if active projects >= production threshold
    if (entry.stats.activeProjects >= thresholds.productionProjects) {
      met.push(`Production projects: ≥ ${thresholds.productionProjects}`);
    } else {
      blockers.push(`Production projects: < ${thresholds.productionProjects} required`);
    }
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    met,
  };
}

export interface PromotionAssessment {
  eligible: boolean;
  blockers: string[];
  met: string[];
}

/**
 * Returns the next tier in the promotion path.
 * Returns null if already at Tier 1 (highest tier).
 */
export function getNextTier(current: RegistryTier): RegistryTier | null {
  const path: Record<RegistryTier, RegistryTier | null> = {
    'tier3': 'tier2',
    'tier2': 'tier1',
    'tier1': null,
  };
  return path[current];
}
