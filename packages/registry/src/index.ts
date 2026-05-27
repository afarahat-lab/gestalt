/**
 * @agentforge-sdlc/registry
 * Public exports for the harness registry and ecosystem layer.
 */

export type {
  RegistryEntry, RegistryTier, RegistryEntryType, RegistryEntryStatus,
  RegistryAuthor, RegistrySource, RegistryMetadata, RegistryStats,
  RegistryBadge, RegistrySearchParams, RegistrySearchResult,
  RegistrySubmission, AutomatedCheckResult,
  PromotionRequest, PromotionCriteria, StackTag,
} from './types';

export { RegistryClient, RegistryError } from './api/client';
export { validateEntry }               from './validators/entry-validator';
export { assessPromotionReadiness, getNextTier } from './promotion/promotion-engine';
